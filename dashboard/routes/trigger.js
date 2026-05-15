const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const router = express.Router();

const BASE_DIR = path.resolve(__dirname, '../..');
const REVIEW_SCRIPT = path.join(BASE_DIR, 'review-single.sh');
const CRON_SCRIPT = path.join(BASE_DIR, 'cron-pr-review.sh');
const LOGS_DIR = path.join(BASE_DIR, 'logs');

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

router.activeJobs = activeJobs;
module.exports = router;
