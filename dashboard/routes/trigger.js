const express = require('express');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const db = require('../db');

const router = express.Router();

const BASE_DIR = path.resolve(__dirname, '../..');
const REVIEW_SCRIPT = path.join(BASE_DIR, 'review-single.sh');
const CRON_SCRIPT = path.join(BASE_DIR, 'cron-pr-review.sh');
const LOGS_DIR = path.join(BASE_DIR, 'logs');
const APPROVED_DIR = path.join(BASE_DIR, 'approved');
const REPO = 'tinyhumansai/openhuman';

// Track active jobs in memory
const activeJobs = new Map();

// Keep last N lines of output per job for live tailing
const MAX_LOG_LINES = 500;

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

// POST /api/trigger/review/:id
router.post('/review/:id', (req, res) => {
  const prId = parseInt(req.params.id, 10);

  const jobId = `review-${prId}`;
  if (activeJobs.has(jobId)) {
    return res.status(409).json({ error: `Review for PR #${prId} is already running` });
  }

  const logFile = path.join(LOGS_DIR, `review-PR-${prId}-manual-${timestamp()}.log`);
  const logStream = fs.createWriteStream(logFile, { flags: 'a' });

  const child = spawn('bash', [REVIEW_SCRIPT, String(prId)], {
    cwd: BASE_DIR,
    env: { ...process.env, PATH: process.env.PATH, DASHBOARD_MODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const job = {
    pid: child.pid,
    pr: prId,
    type: 'review',
    startedAt: new Date().toISOString(),
    logFile,
    logLines: [],
    exitCode: null,
    done: false,
    child, // keep reference for cancel
  };
  activeJobs.set(jobId, job);

  const appendLine = (line) => {
    job.logLines.push(line);
    if (job.logLines.length > MAX_LOG_LINES) {
      job.logLines.shift();
    }
  };

  let stdoutBuf = '';
  child.stdout.on('data', (chunk) => {
    logStream.write(chunk);
    stdoutBuf += chunk.toString();
    const lines = stdoutBuf.split('\n');
    stdoutBuf = lines.pop(); // keep incomplete line in buffer
    lines.forEach(l => appendLine(l));
  });

  let stderrBuf = '';
  child.stderr.on('data', (chunk) => {
    logStream.write(chunk);
    stderrBuf += chunk.toString();
    const lines = stderrBuf.split('\n');
    stderrBuf = lines.pop();
    lines.forEach(l => appendLine(`[stderr] ${l}`));
  });

  child.on('close', (code) => {
    if (stdoutBuf) appendLine(stdoutBuf);
    if (stderrBuf) appendLine(`[stderr] ${stderrBuf}`);
    logStream.end();
    job.exitCode = code;
    job.done = true;
    job.endedAt = new Date().toISOString();
    // Clear status.json so dashboard doesn't show stale running state
    try {
      const sf = path.join(BASE_DIR, 'status.json');
      const st = JSON.parse(fs.readFileSync(sf, 'utf-8'));
      if (st.pr === prId) fs.writeFileSync(sf, JSON.stringify({ running: false }));
    } catch {}
    console.log(`[trigger] Review of PR #${prId} finished with code ${code}`);
    // Keep job around for 5 min so the UI can show final state
    setTimeout(() => activeJobs.delete(jobId), 5 * 60 * 1000);
  });

  child.on('error', (err) => {
    appendLine(`[error] ${err.message}`);
    logStream.end();
    job.done = true;
    job.exitCode = -1;
    job.endedAt = new Date().toISOString();
    console.error(`[trigger] Review of PR #${prId} failed: ${err.message}`);
    setTimeout(() => activeJobs.delete(jobId), 5 * 60 * 1000);
  });

  res.json({
    jobId,
    pr: prId,
    pid: child.pid,
    logFile,
    message: `Review started for PR #${prId}`,
  });
});

// POST /api/trigger/discover
router.post('/discover', (req, res) => {
  if (activeJobs.has('discover')) {
    return res.status(409).json({ error: 'Discovery is already running' });
  }

  const logFile = path.join(LOGS_DIR, `review-${timestamp()}.log`);
  const logStream = fs.createWriteStream(logFile, { flags: 'a' });

  const child = spawn('bash', [CRON_SCRIPT], {
    cwd: BASE_DIR,
    env: { ...process.env, PATH: process.env.PATH },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const job = {
    pid: child.pid,
    type: 'discover',
    startedAt: new Date().toISOString(),
    logFile,
    logLines: [],
    exitCode: null,
    done: false,
    child,
  };
  activeJobs.set('discover', job);

  const appendLine = (line) => {
    job.logLines.push(line);
    if (job.logLines.length > MAX_LOG_LINES) job.logLines.shift();
  };

  let stdoutBuf = '';
  child.stdout.on('data', (chunk) => {
    logStream.write(chunk);
    stdoutBuf += chunk.toString();
    const lines = stdoutBuf.split('\n');
    stdoutBuf = lines.pop();
    lines.forEach(l => appendLine(l));
  });

  let stderrBuf = '';
  child.stderr.on('data', (chunk) => {
    logStream.write(chunk);
    stderrBuf += chunk.toString();
    const lines = stderrBuf.split('\n');
    stderrBuf = lines.pop();
    lines.forEach(l => appendLine(`[stderr] ${l}`));
  });

  child.on('close', (code) => {
    if (stdoutBuf) appendLine(stdoutBuf);
    if (stderrBuf) appendLine(`[stderr] ${stderrBuf}`);
    logStream.end();
    job.exitCode = code;
    job.done = true;
    job.endedAt = new Date().toISOString();
    console.log(`[trigger] Discovery finished with code ${code}`);
    setTimeout(() => activeJobs.delete('discover'), 5 * 60 * 1000);
  });

  child.on('error', (err) => {
    appendLine(`[error] ${err.message}`);
    logStream.end();
    job.done = true;
    job.exitCode = -1;
    job.endedAt = new Date().toISOString();
    console.error(`[trigger] Discovery failed: ${err.message}`);
    setTimeout(() => activeJobs.delete('discover'), 5 * 60 * 1000);
  });

  res.json({
    jobId: 'discover',
    pid: child.pid,
    logFile,
    message: 'Discovery started',
  });
});

// GET /api/trigger/jobs — list active jobs
router.get('/jobs', (req, res) => {
  const jobs = {};
  for (const [id, job] of activeJobs) {
    jobs[id] = {
      pid: job.pid,
      pr: job.pr,
      type: job.type,
      startedAt: job.startedAt,
      endedAt: job.endedAt || null,
      done: job.done,
      exitCode: job.exitCode,
      lineCount: job.logLines.length,
    };
  }
  res.json(jobs);
});

// GET /api/trigger/log/:jobId?after=N — live log tail
router.get('/log/:jobId', (req, res) => {
  const jobId = req.params.jobId;
  const after = parseInt(req.query.after || '0', 10);

  const job = activeJobs.get(jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  const lines = job.logLines.slice(after);

  res.json({
    jobId,
    done: job.done,
    exitCode: job.exitCode,
    startedAt: job.startedAt,
    endedAt: job.endedAt || null,
    total: job.logLines.length,
    after,
    lines,
  });
});

// POST /api/trigger/approve/:id — approve a clean PR
router.post('/approve/:id', (req, res) => {
  const prId = parseInt(req.params.id, 10);
  const now = new Date().toISOString();
  const logLines = [];
  const log = (msg) => { logLines.push(`[${new Date().toISOString()}] ${msg}`); console.log(`[approve] ${msg}`); };

  try {
    // 1. Validate PR exists and is clean
    const pr = db.getPrById(prId);
    if (!pr) return res.status(404).json({ error: 'PR not found' });
    if (pr.status !== 'clean') {
      return res.status(400).json({
        error: `PR #${prId} is not in clean status (current: ${pr.status})`,
        checks: { status_clean: false, ci_passing: null, no_conflicts: null },
      });
    }
    log(`PR #${prId} — status is clean, running pre-flight checks...`);

    // 2. Pre-flight: CI not failing (pass + skipped is fine, only fail blocks)
    let ciPassing = true;
    try {
      const ciOut = execSync(
        `gh pr checks ${prId} --repo ${REPO} --json bucket --jq '[.[].bucket] | any(. == "fail")'`,
        { encoding: 'utf-8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] }
      ).trim();
      ciPassing = ciOut !== 'true';
    } catch { ciPassing = true; }
    log(`CI passing (no failures): ${ciPassing}`);

    // 3. Pre-flight: No conflicts
    let noConflicts = false;
    try {
      const mergeOut = execSync(
        `gh pr view ${prId} --repo ${REPO} --json mergeable --jq '.mergeable'`,
        { encoding: 'utf-8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] }
      ).trim();
      noConflicts = mergeOut === 'MERGEABLE';
    } catch { noConflicts = false; }
    log(`No conflicts: ${noConflicts}`);

    const checks = { status_clean: true, ci_passing: ciPassing, no_conflicts: noConflicts };

    if (!ciPassing || !noConflicts) {
      const failures = [];
      if (!ciPassing) failures.push('CI not passing');
      if (!noConflicts) failures.push('merge conflicts');
      log(`Pre-flight failed: ${failures.join(', ')}`);
      writeApproveLog(prId, logLines);
      return res.status(400).json({ error: `Pre-flight failed: ${failures.join(', ')}`, checks });
    }

    // 4. Post APPROVE review
    log('Posting APPROVE review to GitHub...');
    let reviewUrl = null;
    try {
      const reviewOut = execSync(
        `gh api repos/${REPO}/pulls/${prId}/reviews -X POST -f event=APPROVE -f body="Looks good, nice work!"`,
        { encoding: 'utf-8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] }
      );
      const review = JSON.parse(reviewOut);
      reviewUrl = review.html_url || `https://github.com/${REPO}/pull/${prId}#pullrequestreview-${review.id}`;
      log(`Review posted: ${reviewUrl}`);
    } catch (err) {
      log(`Failed to post review: ${err.message}`);
      writeApproveLog(prId, logLines);
      return res.status(500).json({ error: 'Failed to post APPROVE review to GitHub' });
    }

    // 5. Update DB status
    db.updatePrStatus(prId, 'approved');
    log('DB status updated to approved');

    // 6. Update tracking .md file — update status + append approval entry
    const trackingPath = pr.tracking_file_path;
    if (trackingPath && fs.existsSync(trackingPath)) {
      let content = fs.readFileSync(trackingPath, 'utf-8');
      content = content.replace(/\*\*Status\*\*:\s*clean/, '**Status**: approved');
      content += `\n### Approved — ${now}\n**Approved by**: graycyrus\n**Pre-flight**: CI pass | No conflicts\n**GitHub review URL**: ${reviewUrl}\n`;
      fs.writeFileSync(trackingPath, content);
      log(`Tracking file updated: ${path.basename(trackingPath)}`);
    }

    // 7. Move tracking file to approved/
    if (trackingPath && fs.existsSync(trackingPath)) {
      fs.mkdirSync(APPROVED_DIR, { recursive: true });
      const filename = path.basename(trackingPath);
      const newPath = path.join(APPROVED_DIR, filename);
      fs.renameSync(trackingPath, newPath);
      db.updatePrTrackingPath(prId, newPath, 'approved');
      log(`Tracking file moved to approved/${filename}`);
    }

    // 8. Write log
    log(`PR #${prId} approved successfully`);
    writeApproveLog(prId, logLines);

    res.json({ success: true, review_url: reviewUrl, checks });

  } catch (err) {
    log(`Unexpected error: ${err.message}`);
    writeApproveLog(prId, logLines);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/trigger/unapprove/:id — revert an approved PR back to clean
router.post('/unapprove/:id', (req, res) => {
  const prId = parseInt(req.params.id, 10);
  const TO_BE_APPROVED_DIR = path.join(BASE_DIR, 'to-be-approved');

  try {
    const pr = db.getPrById(prId);
    if (!pr) return res.status(404).json({ error: 'PR not found' });
    if (pr.status !== 'approved') {
      return res.status(400).json({ error: `PR #${prId} is not approved (current: ${pr.status})` });
    }

    // Dismiss the APPROVE review on GitHub
    try {
      const reviews = execSync(
        `gh api repos/${REPO}/pulls/${prId}/reviews --jq '[.[] | select(.user.login == "graycyrus" and .state == "APPROVED")] | last | .id'`,
        { encoding: 'utf-8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] }
      ).trim();
      if (reviews) {
        execSync(
          `gh api repos/${REPO}/pulls/${prId}/reviews/${reviews}/dismissals -X PUT -f message="Approval withdrawn" -f event=DISMISS`,
          { encoding: 'utf-8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] }
        );
        console.log(`[trigger] Dismissed APPROVE review ${reviews} on PR #${prId}`);
      }
    } catch (err) {
      console.warn(`[trigger] Could not dismiss review on PR #${prId}: ${err.message}`);
    }

    // Update DB status back to clean
    db.updatePrStatus(prId, 'clean');

    // Move tracking file back to to-be-approved/
    const trackingPath = pr.tracking_file_path;
    if (trackingPath && fs.existsSync(trackingPath)) {
      let content = fs.readFileSync(trackingPath, 'utf-8');
      content = content.replace(/\*\*Status\*\*:\s*approved/, '**Status**: clean');
      fs.writeFileSync(trackingPath, content);

      fs.mkdirSync(TO_BE_APPROVED_DIR, { recursive: true });
      const filename = path.basename(trackingPath);
      const newPath = path.join(TO_BE_APPROVED_DIR, filename);
      fs.renameSync(trackingPath, newPath);
      db.updatePrTrackingPath(prId, newPath, 'to-be-approved');
    }

    console.log(`[trigger] PR #${prId} unapproved — moved back to to-be-approved/`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function writeApproveLog(prId, lines) {
  try {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
    const logFile = path.join(LOGS_DIR, `approve-PR-${prId}-${timestamp()}.log`);
    fs.writeFileSync(logFile, lines.join('\n') + '\n');
  } catch {}
}

// GET /api/trigger/merge-preflight/:id — run pre-merge checks and return results
router.get('/merge-preflight/:id', (req, res) => {
  const prId = parseInt(req.params.id, 10);
  const pr = db.getPrByIdFull ? db.getPrByIdFull(prId) : db.getPrById(prId);
  if (!pr) return res.status(404).json({ error: 'PR not found' });

  const checks = [];

  // Draft check
  try {
    const out = execSync(`gh pr view ${prId} --repo ${REPO} --json isDraft --jq '.isDraft'`, { encoding: 'utf-8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    checks.push({ name: 'Not a draft', pass: out === 'false' });
  } catch { checks.push({ name: 'Not a draft', pass: false }); }

  // Mergeable
  try {
    const out = execSync(`gh pr view ${prId} --repo ${REPO} --json mergeable --jq '.mergeable'`, { encoding: 'utf-8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    checks.push({ name: 'No merge conflicts', pass: out === 'MERGEABLE' });
  } catch { checks.push({ name: 'No merge conflicts', pass: false }); }

  // Review decision
  try {
    const out = execSync(`gh pr view ${prId} --repo ${REPO} --json reviewDecision --jq '.reviewDecision'`, { encoding: 'utf-8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    checks.push({ name: 'Has approval', pass: out === 'APPROVED' });
  } catch { checks.push({ name: 'Has approval', pass: false }); }

  // CI checks
  try {
    const out = execSync(`gh pr checks ${prId} --repo ${REPO} --json name,bucket`, { encoding: 'utf-8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] });
    const ciChecks = JSON.parse(out);
    for (const c of ciChecks) {
      checks.push({ name: c.name, pass: c.bucket === 'pass' || c.bucket === 'skipping', bucket: c.bucket });
    }
  } catch {}

  const allPass = checks.every(c => c.pass);
  const failCount = checks.filter(c => !c.pass).length;

  res.json({ pr: prId, checks, allPass, failCount });
});

// POST /api/trigger/merge/:id — merge PR via gh pr merge --squash
router.post('/merge/:id', (req, res) => {
  const prId = parseInt(req.params.id, 10);
  const githubSync = require('../github-sync');

  const pr = db.getPrByIdFull ? db.getPrByIdFull(prId) : db.getPrById(prId);
  if (!pr) return res.status(404).json({ error: 'PR not found' });

  const eligible = pr.status === 'approved' || pr.status === 'clean' || pr.review_decision === 'APPROVED';
  if (!eligible) {
    return res.status(400).json({ error: `PR #${prId} is not eligible for merge (status: ${pr.status})` });
  }

  try {
    const out = execSync(
      `gh pr merge ${prId} --repo ${REPO} --squash --delete-branch`,
      { encoding: 'utf-8', timeout: 60000, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    console.log(`[trigger] PR #${prId} merged successfully`);

    // Update DB and move tracking file
    githubSync.handlePrMerged(prId);

    // Write log
    fs.mkdirSync(LOGS_DIR, { recursive: true });
    const logFile = path.join(LOGS_DIR, `merge-PR-${prId}-${timestamp()}.log`);
    fs.writeFileSync(logFile, `[${new Date().toISOString()}] PR #${prId} merged via squash\n${out || ''}\n`);

    res.json({ success: true, message: `PR #${prId} merged` });
  } catch (err) {
    console.error(`[trigger] Merge of PR #${prId} failed: ${err.message}`);
    res.status(500).json({ error: `Merge failed: ${err.stderr || err.message}` });
  }
});

// POST /api/trigger/cancel/:jobId — kill a running job
router.post('/cancel/:jobId', (req, res) => {
  const jobId = req.params.jobId;
  const job = activeJobs.get(jobId);

  if (!job) {
    // No job in memory — clear stale status.json if it matches
    const statusFile = path.join(BASE_DIR, 'status.json');
    try {
      const status = JSON.parse(fs.readFileSync(statusFile, 'utf-8'));
      if (status.running) {
        fs.writeFileSync(statusFile, JSON.stringify({ running: false }));
      }
    } catch {}
    return res.json({ message: 'No active job — cleared stale state', jobId });
  }

  if (job.done) {
    return res.json({ message: 'Job already finished', jobId });
  }

  // Kill the process tree: main pid + all children (claude, etc.)
  try {
    // pkill -P kills all children of the process
    execSync(`pkill -TERM -P ${job.pid} 2>/dev/null; kill -TERM ${job.pid} 2>/dev/null`, {
      stdio: 'ignore',
      timeout: 5000,
    });
  } catch {
    // Process may already be dead
  }

  job.logLines.push('[cancelled] Review cancelled by user');
  job.done = true;
  job.exitCode = -1;
  job.endedAt = new Date().toISOString();

  // Clear status.json if it references this PR
  const statusFile = path.join(BASE_DIR, 'status.json');
  try {
    const status = JSON.parse(fs.readFileSync(statusFile, 'utf-8'));
    if (status.pr === job.pr) {
      fs.writeFileSync(statusFile, JSON.stringify({ running: false }));
    }
  } catch {}

  console.log(`[trigger] Job ${jobId} cancelled by user`);

  // Clean up after 1 min
  setTimeout(() => activeJobs.delete(jobId), 60 * 1000);

  res.json({ message: `Job ${jobId} cancelled`, jobId });
});

router.activeJobs = activeJobs;
module.exports = router;
