const express = require('express');
const { execSync, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const db = require('../db');

const router = express.Router();

const BASE_DIR = path.resolve(__dirname, '../..');
const LOGS_DIR = path.join(BASE_DIR, 'logs');
const CRON_SCRIPT = path.join(BASE_DIR, 'cron-pr-review.sh');
const ENV_FILE = path.join(BASE_DIR, '.env');
const REVIEWER_DIR = path.join(BASE_DIR, 'reviewers');

const CRON_PATTERN = 'cron-pr-review.sh';

// --- Helpers ---

function getCrontab() {
  try {
    return execSync('crontab -l 2>/dev/null', { encoding: 'utf-8' });
  } catch {
    return '';
  }
}

function getCronEntry(crontab) {
  const lines = crontab.split('\n');
  return lines.find(l => l.includes(CRON_PATTERN) && !l.trimStart().startsWith('#'));
}

function getDisabledCronEntry(crontab) {
  const lines = crontab.split('\n');
  return lines.find(l => l.includes(CRON_PATTERN) && l.trimStart().startsWith('#'));
}

function parseCronSchedule(entry) {
  if (!entry) return null;
  const clean = entry.replace(/^#\s*/, '').trim();
  const parts = clean.split(/\s+/);
  if (parts.length < 5) return null;
  return parts.slice(0, 5).join(' ');
}

function cronToHuman(schedule) {
  if (!schedule) return 'Unknown';
  const [min, hour, dom, mon, dow] = schedule.split(' ');
  if (min === '*' && hour === '*') return 'Every minute';
  if (min === '0' && hour === '*') return 'Every hour';
  if (min.includes('/')) return `Every ${min.split('/')[1]} minutes`;
  if (hour.includes('/')) return `Every ${hour.split('/')[1]} hours`;
  if (min === '0' && hour !== '*') return `Daily at ${hour}:00`;
  return schedule;
}

function getNextRun(schedule) {
  if (!schedule) return null;
  const [min, hour] = schedule.split(' ');
  const now = new Date();

  if (min === '0' && hour === '*') {
    // Every hour at :00
    const next = new Date(now);
    next.setMinutes(0, 0, 0);
    if (next <= now) next.setHours(next.getHours() + 1);
    return next.toISOString();
  }
  if (min.includes('/')) {
    const interval = parseInt(min.split('/')[1]);
    const next = new Date(now);
    const nextMin = Math.ceil(now.getMinutes() / interval) * interval;
    if (nextMin >= 60) {
      next.setHours(next.getHours() + 1);
      next.setMinutes(0, 0, 0);
    } else {
      next.setMinutes(nextMin, 0, 0);
    }
    if (next <= now) next.setMinutes(next.getMinutes() + interval);
    return next.toISOString();
  }
  return null;
}

function getReviewerInfo() {
  let reviewer = 'cyrus';
  try {
    const env = fs.readFileSync(ENV_FILE, 'utf-8');
    const match = env.match(/^REVIEWER=(.+)$/m);
    if (match) reviewer = match[1].trim();
  } catch {}

  const identityFile = path.join(REVIEWER_DIR, `${reviewer}.md`);
  let identity = null;
  try {
    identity = fs.readFileSync(identityFile, 'utf-8');
  } catch {}

  return { name: reviewer, file: identityFile, exists: !!identity, content: identity };
}

function parseCronLogs() {
  const runs = [];
  try {
    const files = fs.readdirSync(LOGS_DIR)
      .filter(f => f.match(/^review-\d{4}-\d{2}-\d{2}[T-]\d{2,4}.*\.log$/) && !f.includes('-PR-'))
      .sort()
      .reverse()
      .slice(0, 50);

    for (const file of files) {
      const content = fs.readFileSync(path.join(LOGS_DIR, file), 'utf-8');
      const meta = content.match(/CRON_META:\s*started=(\S+)\s+ended=(\S+)\s+discovered=(\d+)\s+reviewed=(\d+)\s+failed=(\d+)/);

      const run = {
        log_file: file,
        log_path: path.join(LOGS_DIR, file),
        status: 'unknown',
      };

      if (meta) {
        run.started_at = meta[1];
        run.ended_at = meta[2];
        run.discovered = parseInt(meta[3]);
        run.reviewed = parseInt(meta[4]);
        run.failed = parseInt(meta[5]);
        const start = new Date(meta[1]);
        const end = new Date(meta[2]);
        run.duration = Math.round((end - start) / 1000);
        run.status = run.failed > 0 ? 'failed' : 'success';
      } else {
        // Extract timestamp from filename (cron format: review-2026-05-26-2321.log or trigger format: review-2026-05-26T23-21-47.log)
        const ts1 = file.match(/review-(\d{4}-\d{2}-\d{2})-(\d{4})/);
        const ts2 = file.match(/review-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})/);
        if (ts1) {
          run.started_at = `${ts1[1]}T${ts1[2].slice(0,2)}:${ts1[2].slice(2)}:00Z`;
        } else if (ts2) {
          run.started_at = `${ts2[1]}T${ts2[2]}:${ts2[3]}:00Z`;
        }

        if (content.includes('No eligible PRs found')) {
          run.discovered = 0;
          run.reviewed = 0;
          run.failed = 0;
          run.duration = 0;
          run.status = 'no_prs';
        } else if (content.includes('=== Done ===')) {
          // Script finished but no CRON_META — parse summary if possible
          const summaryMatch = content.match(/Discovered:\s*(\d+).*\nSucceeded:\s*(\d+).*\nFailed:\s*(\d+)/);
          if (summaryMatch) {
            run.discovered = parseInt(summaryMatch[1]);
            run.reviewed = parseInt(summaryMatch[2]);
            run.failed = parseInt(summaryMatch[3]);
            run.status = run.failed > 0 ? 'failed' : 'success';
          } else {
            run.status = 'success';
          }
        } else {
          // No CRON_META, no "Done" — check if file is still being written to
          const stat = fs.statSync(path.join(LOGS_DIR, file));
          const ageMs = Date.now() - stat.mtimeMs;
          if (ageMs > 5 * 60 * 1000) {
            // Not modified in 5+ minutes — stalled/failed
            run.status = 'failed';
          } else {
            run.status = 'running';
          }
        }
      }

      runs.push(run);
    }
  } catch {}
  return runs;
}

// --- Routes ---

// GET /api/cron/status
router.get('/status', (req, res) => {
  const crontab = getCrontab();
  const activeEntry = getCronEntry(crontab);
  const disabledEntry = getDisabledCronEntry(crontab);
  const entry = activeEntry || disabledEntry;
  const schedule = parseCronSchedule(entry);
  const reviewer = getReviewerInfo();

  // Check if cron/review processes are running
  let running = false;
  try {
    execSync('pgrep -f "cron-pr-review.sh" >/dev/null 2>&1');
    running = true;
  } catch {}

  res.json({
    active: !!activeEntry,
    running,
    schedule,
    human_schedule: cronToHuman(schedule),
    next_run: activeEntry ? getNextRun(schedule) : null,
    cron_entry: entry ? entry.trim() : null,
    script: CRON_SCRIPT,
    reviewer,
  });
});

// POST /api/cron/toggle
router.post('/toggle', (req, res) => {
  const crontab = getCrontab();
  const activeEntry = getCronEntry(crontab);
  const disabledEntry = getDisabledCronEntry(crontab);

  let newCrontab;

  if (activeEntry) {
    // Disable: comment out the line
    newCrontab = crontab.replace(activeEntry, '# ' + activeEntry);
  } else if (disabledEntry) {
    // Enable: uncomment the line
    newCrontab = crontab.replace(disabledEntry, disabledEntry.replace(/^#\s*/, ''));
  } else {
    // No entry at all — add a default one
    const defaultEntry = `0 * * * * ${CRON_SCRIPT}`;
    newCrontab = crontab.trimEnd() + '\n' + defaultEntry + '\n';
  }

  try {
    const { spawnSync } = require('child_process');
    const result = spawnSync('crontab', ['-'], { input: newCrontab, encoding: 'utf-8', timeout: 5000 });
    if (result.status !== 0) throw new Error(result.stderr || 'crontab failed');
    const nowActive = !activeEntry;
    res.json({ active: nowActive, message: nowActive ? 'Cron activated' : 'Cron deactivated' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update crontab', details: err.message });
  }
});

// POST /api/cron/schedule — update the cron schedule
router.post('/schedule', (req, res) => {
  const { schedule } = req.body;
  if (!schedule || !/^[\d\*\/\-,]+(\s+[\d\*\/\-,]+){4}$/.test(schedule.trim())) {
    return res.status(400).json({ error: 'Invalid cron expression' });
  }

  const crontab = getCrontab();
  const activeEntry = getCronEntry(crontab);
  const disabledEntry = getDisabledCronEntry(crontab);
  const entry = activeEntry || disabledEntry;

  const newEntry = `${schedule.trim()} ${CRON_SCRIPT}`;
  let newCrontab;

  if (entry) {
    newCrontab = crontab.replace(entry, newEntry);
  } else {
    newCrontab = crontab.trimEnd() + '\n' + newEntry + '\n';
  }

  try {
    const { spawnSync } = require('child_process');
    const result = spawnSync('crontab', ['-'], { input: newCrontab, encoding: 'utf-8', timeout: 5000 });
    if (result.status !== 0) throw new Error(result.stderr || 'crontab failed');
    res.json({ schedule: schedule.trim(), human: cronToHuman(schedule.trim()) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update crontab', details: err.message });
  }
});

// GET /api/cron/history
router.get('/history', (req, res) => {
  const runs = parseCronLogs();
  res.json(runs);
});

// GET /api/cron/log/:filename
router.get('/log/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const filepath = path.join(LOGS_DIR, filename);

  if (!fs.existsSync(filepath)) {
    return res.status(404).json({ error: 'Log not found' });
  }

  const content = fs.readFileSync(filepath, 'utf-8');
  res.type('text/plain').send(content);
});

// GET /api/cron/reviewers — list available reviewer identities
router.get('/reviewers', (req, res) => {
  try {
    const files = fs.readdirSync(REVIEWER_DIR).filter(f => f.endsWith('.md'));
    const reviewers = files.map(f => {
      const name = f.replace('.md', '');
      const content = fs.readFileSync(path.join(REVIEWER_DIR, f), 'utf-8');
      const titleMatch = content.match(/^#\s+(.+)/m);
      return {
        name,
        file: f,
        title: titleMatch ? titleMatch[1] : name,
      };
    });
    res.json(reviewers);
  } catch {
    res.json([]);
  }
});

// POST /api/cron/stop — kill ALL running cron + review processes
router.post('/stop', (req, res) => {
  const killed = [];

  try {
    // Kill cron-pr-review.sh and all its children
    const cronPids = execSync(`pgrep -f "cron-pr-review.sh" 2>/dev/null`, { encoding: 'utf-8' }).trim().split('\n').filter(Boolean);
    for (const pid of cronPids) {
      try { execSync(`pkill -TERM -P ${pid} 2>/dev/null; kill -TERM ${pid} 2>/dev/null`, { stdio: 'ignore', timeout: 3000 }); } catch {}
      killed.push({ type: 'cron', pid });
    }
  } catch {}

  try {
    // Kill review-single.sh processes
    const reviewPids = execSync(`pgrep -f "review-single.sh" 2>/dev/null`, { encoding: 'utf-8' }).trim().split('\n').filter(Boolean);
    for (const pid of reviewPids) {
      try { execSync(`pkill -TERM -P ${pid} 2>/dev/null; kill -TERM ${pid} 2>/dev/null`, { stdio: 'ignore', timeout: 3000 }); } catch {}
      killed.push({ type: 'review', pid });
    }
  } catch {}

  try {
    // Kill any claude processes spawned by reviews
    const claudePids = execSync(`pgrep -f "claude.*-p" 2>/dev/null`, { encoding: 'utf-8' }).trim().split('\n').filter(Boolean);
    for (const pid of claudePids) {
      try { process.kill(parseInt(pid), 'SIGTERM'); } catch {}
      killed.push({ type: 'claude', pid });
    }
  } catch {}

  // Clear status.json
  const statusFile = path.join(BASE_DIR, 'status.json');
  try { fs.writeFileSync(statusFile, JSON.stringify({ running: false })); } catch {}

  res.json({ message: `Stopped ${killed.length} process(es)`, killed });
});

module.exports = router;
