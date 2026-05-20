// Spawn PR reviews into windows of a long-lived tmux session so the user can
// attach via terminal (`tmux attach -t super-review`) to watch progress or
// intervene. Each PR gets its own window named `pr-<id>`.
//
// Completion is tracked via a sentinel file under .tmux-state/pr-<id>.exit
// containing the script's exit code. The pane stays open with a bash shell
// after the script finishes (`exec bash`) so output remains scrollable.

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const SESSION = 'super-review';
const BASE_DIR = path.resolve(process.cwd(), '..');
const STATE_DIR = path.join(BASE_DIR, '.tmux-state');

function exec(cmd) {
  return execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

function tryExec(cmd) {
  try { return exec(cmd); } catch { return null; }
}

function isAvailable() {
  return tryExec('command -v tmux') !== null;
}

function sessionExists() {
  return tryExec(`tmux has-session -t ${SESSION} 2>/dev/null`) !== null;
}

function ensureSession() {
  if (sessionExists()) return;
  exec(`tmux new-session -d -s ${SESSION} -n _dashboard`);
}

function listWindows() {
  if (!sessionExists()) return [];
  const out = tryExec(`tmux list-windows -t ${SESSION} -F '#{window_name}'`);
  return out ? out.split('\n').filter(Boolean) : [];
}

function windowName(prId) {
  return `pr-${prId}`;
}

function hasWindow(prId) {
  return listWindows().includes(windowName(prId));
}

function markerPath(prId) {
  return path.join(STATE_DIR, `pr-${prId}.exit`);
}

function killWindow(prId) {
  tryExec(`tmux kill-window -t ${SESSION}:${windowName(prId)} 2>/dev/null`);
  try { fs.unlinkSync(markerPath(prId)); } catch {}
}

/**
 * Spawn `review-single.sh <prId>` in a new tmux window. Returns metadata.
 * If a window for this PR already exists, kills it first.
 */
function startReview(prId, logFile) {
  if (!isAvailable()) throw new Error('tmux is not installed on PATH');
  ensureSession();
  fs.mkdirSync(STATE_DIR, { recursive: true });

  if (hasWindow(prId)) killWindow(prId);

  const marker = markerPath(prId);
  try { fs.unlinkSync(marker); } catch {}

  // Single-quoted shell-form so escaping is straightforward. We pass it to
  // tmux as one argument; tmux runs it with /bin/sh -c.
  const script = [
    `cd ${quote(BASE_DIR)}`,
    `DASHBOARD_MODE=1 bash review-single.sh ${Number(prId)} 2>&1 | tee ${quote(logFile)}`,
    `echo $? > ${quote(marker)}`,
    'exec bash',
  ].join(' ; ');

  exec(`tmux new-window -t ${SESSION} -n ${windowName(prId)} -c ${quote(BASE_DIR)} ${quote(script)}`);
  return { session: SESSION, window: windowName(prId), logFile, marker, attach: `tmux attach -t ${SESSION} \\; select-window -t ${windowName(prId)}` };
}

/**
 * Check whether the review is still running:
 *  - window exists, AND
 *  - the exit-code sentinel hasn't been written yet
 */
function isRunning(prId) {
  if (!hasWindow(prId)) return false;
  return !fs.existsSync(markerPath(prId));
}

function exitCode(prId) {
  try {
    const v = fs.readFileSync(markerPath(prId), 'utf-8').trim();
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function paneCommand(prId) {
  return tryExec(`tmux display-message -t ${SESSION}:${windowName(prId)} -p '#{pane_current_command}' 2>/dev/null`);
}

// Minimal single-quote escape: 'foo' → 'foo' ; 'it\'s' → 'it'\''s'
function quote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

/**
 * Enumerate all panes in the super-review session with their current
 * foreground command and working directory.
 */
function listPanes() {
  if (!sessionExists()) return [];
  const out = tryExec(
    `tmux list-panes -s -t ${SESSION} -F '#{pane_id}\t#{window_name}\t#{pane_current_command}\t#{pane_current_path}'`,
  );
  if (!out) return [];
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [pane_id, window, command, cwd] = line.split('\t');
      return { pane_id, window, command, cwd };
    });
}

const IDLE_SHELLS = new Set(['bash', 'zsh', 'sh', 'fish']);

/**
 * Returns the set of pane_ids that are currently reserved by an in-flight
 * fix. A "reserved" pane has a fix-<prId>.json mapping but no matching
 * .exit sentinel yet — i.e. claude/pnpm is presumably still running there.
 * Used to prevent two rapid Fix clicks from both grabbing the same pane
 * before tmux's pane_current_command updates from `zsh` to `node`/`claude`.
 */
function reservedPaneIds() {
  const reserved = new Set();
  let entries;
  try { entries = fs.readdirSync(STATE_DIR); } catch { return reserved; }
  for (const file of entries) {
    const m = file.match(/^fix-(\d+)\.json$/);
    if (!m) continue;
    const prId = m[1];
    if (fs.existsSync(path.join(STATE_DIR, `fix-${prId}.exit`))) continue;
    try {
      const data = JSON.parse(fs.readFileSync(path.join(STATE_DIR, file), 'utf-8'));
      if (data.pane_id) reserved.add(data.pane_id);
    } catch {}
  }
  return reserved;
}

/**
 * Find an idle pane that's already sitting in an openhuman workspace clone.
 * "Idle" means its foreground command is a plain shell AND no in-flight
 * fix has already claimed the pane (the latter is the race fix).
 */
function pickIdlePane() {
  const reserved = reservedPaneIds();
  return (
    listPanes().find(
      (p) =>
        IDLE_SHELLS.has(p.command) &&
        /\/openhuman-\d+(?:\/|$)/.test(p.cwd || '') &&
        !reserved.has(p.pane_id),
    ) ?? null
  );
}

function fixMappingPath(prId) {
  return path.join(STATE_DIR, `fix-${prId}.json`);
}

function fixMarkerPath(prId) {
  return path.join(STATE_DIR, `fix-${prId}.exit`);
}

/**
 * Send `pnpm review fix <prId>` to an idle openhuman-* pane via send-keys.
 * Writes a mapping file capturing which pane was targeted so we can show
 * status / cancel later. Tee'ing is impossible (claude needs a real TTY),
 * so we attach `tmux pipe-pane` to mirror output to logFile.
 */
function startFixInPane(prId, logFile) {
  if (!isAvailable()) throw new Error('tmux is not installed on PATH');
  ensureSession();
  fs.mkdirSync(STATE_DIR, { recursive: true });

  if (isFixRunning(prId)) {
    throw new Error(`Fix for PR #${prId} is already running`);
  }

  const pane = pickIdlePane();
  if (!pane) {
    throw new Error(
      'No idle openhuman-* pane available. Start one in your tmux session, or free up an existing one.',
    );
  }

  try { fs.unlinkSync(fixMarkerPath(prId)); } catch {}

  const marker = fixMarkerPath(prId);
  // The trailing `; echo $? > marker` runs in the same shell after the fix
  // completes, capturing its exit code. Sending C-m executes the line.
  const cmd = `pnpm review fix ${Number(prId)} ; echo $? > ${quote(marker)}`;
  exec(`tmux send-keys -t ${pane.pane_id} ${quote(cmd)} C-m`);

  // Pipe pane output to a log file. -o toggles, but the pane was idle so
  // there shouldn't be an existing pipe.
  tryExec(`tmux pipe-pane -o -t ${pane.pane_id} ${quote(`cat >> ${logFile}`)}`);

  const mapping = {
    pane_id: pane.pane_id,
    window: pane.window,
    workspace: pane.cwd,
    logFile,
    started_at: new Date().toISOString(),
  };
  fs.writeFileSync(fixMappingPath(prId), JSON.stringify(mapping, null, 2));

  return {
    session: SESSION,
    window: pane.window,
    pane_id: pane.pane_id,
    workspace: pane.cwd,
    logFile,
    marker,
    attach: `tmux attach -t ${SESSION} \\; select-window -t ${pane.window}`,
  };
}

function getFixMapping(prId) {
  try {
    return JSON.parse(fs.readFileSync(fixMappingPath(prId), 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Capture the visible content of a pane. `-S -<lines>` starts that many
 * lines back from the bottom so we get scrollback context.
 */
function capturePane(paneId, opts = {}) {
  const lines = Math.max(20, Math.min(2000, opts.lines || 400));
  const raw = tryExec(`tmux capture-pane -p -t ${paneId} -S -${lines}`);
  return raw ?? '';
}

/**
 * List panes that are candidates for running a fix: foreground command is
 * an idle shell, cwd is an openhuman-N clone, and no in-flight fix has
 * already claimed the pane.
 */
function listIdleOpenhumanPanes() {
  const reserved = reservedPaneIds();
  return listPanes().filter(
    (p) =>
      IDLE_SHELLS.has(p.command) &&
      /\/openhuman-\d+(?:\/|$)/.test(p.cwd || '') &&
      !reserved.has(p.pane_id),
  );
}

/**
 * Same as startFixInPane but accepts an explicit pane id. Falls back to
 * the auto-picker when paneId is null/undefined.
 */
function startFixInSpecificPane(prId, logFile, paneId) {
  if (!paneId) return startFixInPane(prId, logFile);
  if (!isAvailable()) throw new Error('tmux is not installed on PATH');
  ensureSession();
  fs.mkdirSync(STATE_DIR, { recursive: true });
  if (isFixRunning(prId)) throw new Error(`Fix for PR #${prId} is already running`);

  const pane = listPanes().find((p) => p.pane_id === paneId);
  if (!pane) throw new Error(`Pane ${paneId} not found`);
  if (!IDLE_SHELLS.has(pane.command)) throw new Error(`Pane ${paneId} is busy (${pane.command})`);
  if (reservedPaneIds().has(pane.pane_id)) {
    throw new Error(`Pane ${paneId} already has an in-flight fix running`);
  }

  try { fs.unlinkSync(fixMarkerPath(prId)); } catch {}
  const marker = fixMarkerPath(prId);
  const cmd = `pnpm review fix ${Number(prId)} ; echo $? > ${quote(marker)}`;
  exec(`tmux send-keys -t ${pane.pane_id} ${quote(cmd)} C-m`);
  tryExec(`tmux pipe-pane -o -t ${pane.pane_id} ${quote(`cat >> ${logFile}`)}`);

  const mapping = {
    pane_id: pane.pane_id,
    window: pane.window,
    workspace: pane.cwd,
    logFile,
    started_at: new Date().toISOString(),
  };
  fs.writeFileSync(fixMappingPath(prId), JSON.stringify(mapping, null, 2));
  return {
    session: SESSION,
    window: pane.window,
    pane_id: pane.pane_id,
    workspace: pane.cwd,
    logFile,
    marker,
    attach: `tmux attach -t ${SESSION} \\; select-window -t ${pane.window}`,
  };
}

/**
 * Legacy: spawn `pnpm review fix` in its own new window. Kept around but
 * unused — the pane-targeting flow is the default.
 */
function startFix(prId, workspaceDir, logFile) {
  if (!isAvailable()) throw new Error('tmux is not installed on PATH');
  if (!fs.existsSync(workspaceDir)) throw new Error(`workspace not found: ${workspaceDir}`);
  ensureSession();
  fs.mkdirSync(STATE_DIR, { recursive: true });

  const window = `fix-${prId}`;
  if (listWindows().includes(window)) {
    tryExec(`tmux kill-window -t ${SESSION}:${window} 2>/dev/null`);
  }
  const marker = path.join(STATE_DIR, `fix-${prId}.exit`);
  try { fs.unlinkSync(marker); } catch {}

  // `pnpm review fix` spawns interactive `claude`, so we can't pipe it
  // through `tee` (would break the TTY). Use `tmux pipe-pane` instead to
  // mirror the pane's output to a log file without disturbing the terminal.
  const script = [
    `cd ${quote(workspaceDir)}`,
    `pnpm review fix ${Number(prId)}`,
    `echo $? > ${quote(marker)}`,
    'exec bash',
  ].join(' ; ');

  exec(`tmux new-window -t ${SESSION} -n ${window} -c ${quote(workspaceDir)} ${quote(script)}`);
  // Mirror pane output to the log file in the background.
  tryExec(`tmux pipe-pane -o -t ${SESSION}:${window} ${quote(`cat >> ${logFile}`)}`);
  return {
    session: SESSION,
    window,
    logFile,
    marker,
    workspace: workspaceDir,
    attach: `tmux attach -t ${SESSION} \\; select-window -t ${window}`,
  };
}

function isFixRunning(prId) {
  // Pane-based flow: mapping file exists and exit-code sentinel hasn't been
  // written yet. Falls through to false if the user never triggered a fix.
  const mapping = getFixMapping(prId);
  if (!mapping) {
    // Backwards compat with the new-window flow.
    if (!listWindows().includes(`fix-${prId}`)) return false;
    return !fs.existsSync(fixMarkerPath(prId));
  }
  return !fs.existsSync(fixMarkerPath(prId));
}

function killFix(prId) {
  const mapping = getFixMapping(prId);
  if (mapping?.pane_id) {
    // Ctrl-C the foreground process. Don't kill the pane itself — it might
    // be one of the user's openhuman workspace panes they still want.
    tryExec(`tmux send-keys -t ${mapping.pane_id} C-c`);
    tryExec(`tmux pipe-pane -t ${mapping.pane_id}`); // stop piping
  } else {
    tryExec(`tmux kill-window -t ${SESSION}:fix-${prId} 2>/dev/null`);
  }
  try { fs.unlinkSync(fixMarkerPath(prId)); } catch {}
  try { fs.unlinkSync(fixMappingPath(prId)); } catch {}
}

module.exports = {
  SESSION,
  STATE_DIR,
  isAvailable,
  sessionExists,
  ensureSession,
  startReview,
  startFix,
  startFixInPane,
  startFixInSpecificPane,
  killWindow,
  killFix,
  hasWindow,
  isRunning,
  isFixRunning,
  getFixMapping,
  exitCode,
  paneCommand,
  listWindows,
  listPanes,
  pickIdlePane,
  listIdleOpenhumanPanes,
  capturePane,
  reservedPaneIds,
  sendToPane,
  sendKey,
};

/**
 * Type `text` into a pane and press Enter. Used by the Fix Terminal UI so
 * the user can prompt claude (or any program holding the pane) without
 * leaving the dashboard.
 */
function sendToPane(paneId, text) {
  if (!paneId) throw new Error('pane_id is required');
  // -l (literal) prevents tmux from interpreting key names inside the text.
  // Without it, a stray `Enter` token in the user's prompt would be eaten.
  exec(`tmux send-keys -l -t ${paneId} ${quote(text)}`);
  exec(`tmux send-keys -t ${paneId} C-m`);
}

/**
 * Send a named key (no Enter). Lets the UI offer quick keys like Escape,
 * Ctrl-C, arrow keys, etc.
 */
function sendKey(paneId, key) {
  if (!paneId) throw new Error('pane_id is required');
  // tmux key names: Escape, Enter, Up, Down, C-c, M-Up, etc.
  exec(`tmux send-keys -t ${paneId} ${quote(key)}`);
}
