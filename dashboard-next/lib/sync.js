const fs = require('fs');
const path = require('path');
const db = require('./db');
const { parseTrackingFile, parseCronLog } = require('./parser');

// process.cwd() is the dashboard-next/ project root; repo root is one level up
const BASE_DIR = path.resolve(process.cwd(), '..');
const TRACKING_DIR = path.join(BASE_DIR, 'tinyhumansai-openhuman');
const APPROVED_DIR = path.join(BASE_DIR, 'to-be-approved');
const FULLY_APPROVED_DIR = path.join(BASE_DIR, 'approved');
const MERGED_DIR = path.join(BASE_DIR, 'already-merged');
const LOGS_DIR = path.join(BASE_DIR, 'logs');
const STATUS_FILE = path.join(BASE_DIR, 'status.json');

const DEBOUNCE_MS = 500;
const debounceTimers = new Map();

function debounced(key, fn) {
  if (debounceTimers.has(key)) clearTimeout(debounceTimers.get(key));
  debounceTimers.set(key, setTimeout(() => {
    debounceTimers.delete(key);
    fn();
  }, DEBOUNCE_MS));
}

function syncFile(filePath, location) {
  if (!filePath.match(/PR-\d+\.md$/)) return;

  try {
    const { pr, cycles } = parseTrackingFile(filePath);
    if (!pr.id) return;

    pr.location = location;

    db.upsertPr({
      id: pr.id,
      title: pr.title,
      author: pr.author,
      branch: pr.branch,
      base_branch: pr.base_branch,
      url: pr.url,
      created_at: pr.created_at,
      status: pr.status,
      is_member: null,
      last_reviewed_commit: pr.last_reviewed_commit,
      last_review_date: pr.last_review_date,
      tracking_file_path: filePath,
      location,
    });

    if (cycles.length > 0) {
      db.replaceCyclesForPr(pr.id, cycles);
    }

    console.log(`[sync] Updated PR #${pr.id} from ${path.basename(filePath)}`);
  } catch (err) {
    console.error(`[sync] Error parsing ${filePath}: ${err.message}`);
  }
}

function watchDir(dirPath, location) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  const watcher = fs.watch(dirPath, (eventType, filename) => {
    if (!filename || !filename.match(/^PR-\d+\.md$/)) return;
    const fullPath = path.join(dirPath, filename);
    debounced(fullPath, () => {
      if (fs.existsSync(fullPath)) {
        syncFile(fullPath, location);
      }
    });
  });

  return watcher;
}

let _liveStatus = null;

function watchStatusFile() {
  if (!fs.existsSync(path.dirname(STATUS_FILE))) return null;

  // Read initial status
  readStatusFile();

  try {
    const watcher = fs.watch(path.dirname(STATUS_FILE), (eventType, filename) => {
      if (filename === 'status.json') {
        debounced(STATUS_FILE, readStatusFile);
      }
    });
    return watcher;
  } catch {
    return null;
  }
}

function readStatusFile() {
  try {
    if (fs.existsSync(STATUS_FILE)) {
      const raw = fs.readFileSync(STATUS_FILE, 'utf-8');
      _liveStatus = JSON.parse(raw);
    } else {
      _liveStatus = null;
    }
  } catch {
    _liveStatus = null;
  }
}

function getLiveStatus() {
  return _liveStatus;
}

let watchers = [];
let rescanInterval = null;

// fs.watch() on macOS reliably catches dir entry add/remove but frequently
// misses in-place modifications to existing files. Review scripts overwrite
// the tracking .md files, so fs.watch alone leaves the DB stale until the
// next GitHub sync. A cheap mtime-based rescan every 10s closes that gap.
const RESCAN_INTERVAL_MS = 10_000;
const lastSeenMtime = new Map();

function rescanDir(dirPath, location) {
  if (!fs.existsSync(dirPath)) return;
  let entries;
  try { entries = fs.readdirSync(dirPath); } catch { return; }
  for (const filename of entries) {
    if (!/^PR-\d+\.md$/.test(filename)) continue;
    const fullPath = path.join(dirPath, filename);
    let mtime;
    try { mtime = fs.statSync(fullPath).mtimeMs; } catch { continue; }
    if (lastSeenMtime.get(fullPath) === mtime) continue;
    lastSeenMtime.set(fullPath, mtime);
    syncFile(fullPath, location);
  }
}

function periodicRescan() {
  rescanDir(TRACKING_DIR, 'tinyhumansai-openhuman');
  rescanDir(APPROVED_DIR, 'to-be-approved');
  rescanDir(FULLY_APPROVED_DIR, 'approved');
  rescanDir(MERGED_DIR, 'already-merged');
}

function startWatching() {
  console.log('[sync] Starting file watchers...');
  watchers.push(watchDir(TRACKING_DIR, 'tinyhumansai-openhuman'));
  watchers.push(watchDir(APPROVED_DIR, 'to-be-approved'));
  watchers.push(watchDir(FULLY_APPROVED_DIR, 'approved'));
  watchers.push(watchDir(MERGED_DIR, 'already-merged'));
  watchers.push(watchStatusFile());

  // Prime the mtime cache from the initial migration so we don't re-emit
  // every file as "changed" on the first tick.
  periodicRescan();
  rescanInterval = setInterval(periodicRescan, RESCAN_INTERVAL_MS);

  console.log(`[sync] Watching tracking dirs + rescanning every ${RESCAN_INTERVAL_MS / 1000}s`);
}

function stopWatching() {
  for (const w of watchers) {
    if (w) w.close();
  }
  watchers = [];
  if (rescanInterval) { clearInterval(rescanInterval); rescanInterval = null; }
}

module.exports = {
  syncFile,
  startWatching,
  stopWatching,
  getLiveStatus,
};
