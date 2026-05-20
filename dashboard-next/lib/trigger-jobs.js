// Shared in-memory job registry for triggered shell jobs (review/discover).
// Lives in a singleton on globalThis so HMR + multiple route modules see the
// same Map within one Next.js server process.

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const BASE_DIR = path.resolve(process.cwd(), '..');
const LOGS_DIR = path.join(BASE_DIR, 'logs');
const MAX_LOG_LINES = 500;

const globalKey = '__pr_review_active_jobs__';
if (!globalThis[globalKey]) {
  globalThis[globalKey] = new Map();
}
const activeJobs = globalThis[globalKey];

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function ensureLogsDir() {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

// Spawn a shell job, wire stdout/stderr into the in-memory ring buffer + a log
// file, and store it under `jobId`. Returns the job object (or null if a job
// with that id is already running). `onClose` is called with the exit code
// once the process finishes.
function startJob({ jobId, command, args, logFile, type, pr, onClose }) {
  if (activeJobs.has(jobId)) return null;

  ensureLogsDir();
  const logStream = fs.createWriteStream(logFile, { flags: 'a' });

  const child = spawn(command, args, {
    cwd: BASE_DIR,
    env: { ...process.env, PATH: process.env.PATH, DASHBOARD_MODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const job = {
    pid: child.pid,
    pr,
    type,
    startedAt: new Date().toISOString(),
    logFile,
    logLines: [],
    exitCode: null,
    done: false,
    child,
  };
  activeJobs.set(jobId, job);

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
    lines.forEach(appendLine);
  });

  let stderrBuf = '';
  child.stderr.on('data', (chunk) => {
    logStream.write(chunk);
    stderrBuf += chunk.toString();
    const lines = stderrBuf.split('\n');
    stderrBuf = lines.pop();
    lines.forEach((l) => appendLine(`[stderr] ${l}`));
  });

  child.on('close', (code) => {
    if (stdoutBuf) appendLine(stdoutBuf);
    if (stderrBuf) appendLine(`[stderr] ${stderrBuf}`);
    logStream.end();
    job.exitCode = code;
    job.done = true;
    job.endedAt = new Date().toISOString();
    if (onClose) {
      try { onClose(code, job); } catch (e) { console.error('[trigger] onClose error:', e); }
    }
    setTimeout(() => activeJobs.delete(jobId), 5 * 60 * 1000);
  });

  child.on('error', (err) => {
    appendLine(`[error] ${err.message}`);
    logStream.end();
    job.done = true;
    job.exitCode = -1;
    job.endedAt = new Date().toISOString();
    console.error(`[trigger] Job ${jobId} failed: ${err.message}`);
    setTimeout(() => activeJobs.delete(jobId), 5 * 60 * 1000);
  });

  return job;
}

module.exports = {
  activeJobs,
  startJob,
  timestamp,
  BASE_DIR,
  LOGS_DIR,
};
