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

// --- Built-in cron scheduler ---
const scheduler = require('../cron-scheduler');

function intervalToHuman(ms) {
  if (!ms) return 'Disabled';
  const min = ms / 60000;
  if (min < 60) return `Every ${min} minutes`;
  const hr = min / 60;
  if (hr === 1) return 'Every hour';
  return `Every ${hr} hours`;
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
  const cron = scheduler.cronState;
  const reviewer = getReviewerInfo();

  res.json({
    active: cron.active,
    running: cron.running,
    schedule: cron.intervalMs ? `Every ${cron.intervalMs / 60000} min` : 'Disabled',
    human_schedule: intervalToHuman(cron.intervalMs),
    interval_seconds: cron.intervalMs / 1000,
    last_run: cron.lastRun,
    script: CRON_SCRIPT,
    reviewer,
  });
});

// POST /api/cron/toggle
router.post('/toggle', (req, res) => {
  const cron = scheduler.cronState;

  if (cron.active) {
    scheduler.stopCronTimer();
    res.json({ active: false, message: 'Scheduler deactivated' });
  } else {
    if (!cron.intervalMs || cron.intervalMs < 5 * 60 * 1000) {
      cron.intervalMs = 60 * 60 * 1000; // default 1 hour
    }
    scheduler.startCronTimer();
    res.json({ active: true, message: 'Scheduler activated' });
  }
});

// POST /api/cron/schedule — update the schedule interval
router.post('/schedule', (req, res) => {
  let { minutes } = req.body;
  minutes = parseInt(minutes, 10);

  if (!minutes || minutes < 5) {
    return res.status(400).json({ error: 'Minimum interval is 5 minutes' });
  }

  const cron = scheduler.cronState;
  cron.intervalMs = minutes * 60 * 1000;

  // Restart timer if active
  if (cron.active) {
    scheduler.stopCronTimer();
    scheduler.startCronTimer();
  }

  res.json({ minutes, human: intervalToHuman(cron.intervalMs) });
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
