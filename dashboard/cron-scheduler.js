const { spawn } = require('child_process');
const path = require('path');

const CRON_SCRIPT = path.join(__dirname, '..', 'cron-pr-review.sh');

function ts() {
  return new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

const cronState = {
  active: false,
  intervalMs: 0,
  timer: null,
  lastRun: null,
  nextRun: null,
  running: false,
};

function startCronTimer() {
  if (cronState.timer) clearInterval(cronState.timer);
  if (!cronState.intervalMs || cronState.intervalMs < 5 * 60 * 1000) return;
  cronState.active = true;
  const min = cronState.intervalMs / 60000;
  const nextAt = new Date(Date.now() + cronState.intervalMs);
  cronState.nextRun = nextAt.toISOString();
  console.log(`[cron] [${ts()}] ✓ Scheduler ACTIVE — runs every ${min} min`);
  console.log(`[cron] [${ts()}]   Next run: ${nextAt.toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit' })}`);
  cronState.timer = setInterval(fireCron, cronState.intervalMs);
}

function stopCronTimer() {
  if (cronState.timer) clearInterval(cronState.timer);
  cronState.timer = null;
  cronState.active = false;
  cronState.nextRun = null;
  console.log(`[cron] [${ts()}] ✗ Scheduler STOPPED`);
}

function fireCron() {
  if (cronState.running) {
    const runAge = Date.now() - new Date(cronState.lastRun).getTime();
    if (runAge > 30 * 60 * 1000) {
      console.log(`[cron] [${ts()}] ⚠ Previous run stuck for ${Math.round(runAge / 60000)}min — force-resetting`);
      if (cronState.childPid) {
        try { process.kill(cronState.childPid, 'SIGTERM'); } catch {}
      }
      cronState.running = false;
      cronState.childPid = null;
    } else {
      console.log(`[cron] [${ts()}] ⏭ Skipping — previous run still active (started ${cronState.lastRun})`);
      return;
    }
  }
  cronState.running = true;
  cronState.lastRun = new Date().toISOString();
  const nextAt = new Date(Date.now() + cronState.intervalMs);
  cronState.nextRun = nextAt.toISOString();

  console.log(`[cron] [${ts()}] ▶ Cron cycle STARTED`);
  console.log(`[cron] [${ts()}]   Next run after this: ${nextAt.toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit' })}`);

  const startTime = Date.now();
  const MAX_RUN_TIME = 30 * 60 * 1000; // 30 min max per cycle

  const child = spawn('bash', [CRON_SCRIPT], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  cronState.childPid = child.pid;

  // Kill if stuck for too long
  const killTimer = setTimeout(() => {
    if (cronState.running) {
      console.log(`[cron] [${ts()}] ⚠ TIMEOUT — killing stuck run after 30 min (PID ${child.pid})`);
      try { process.kill(-child.pid, 'SIGTERM'); } catch {}
      try { child.kill('SIGTERM'); } catch {}
      cronState.running = false;
    }
  }, MAX_RUN_TIME);

  child.stdout.on('data', (d) => {
    const lines = d.toString().split('\n').filter(Boolean);
    for (const line of lines) {
      console.log(`[cron] ${line}`);
    }
  });

  child.stderr.on('data', (d) => {
    const lines = d.toString().split('\n').filter(Boolean);
    for (const line of lines) {
      console.log(`[cron:err] ${line}`);
    }
  });

  child.on('close', (code) => {
    clearTimeout(killTimer);
    cronState.running = false;
    cronState.childPid = null;
    const duration = Math.round((Date.now() - startTime) / 1000);
    const min = Math.floor(duration / 60);
    const sec = duration % 60;
    console.log(`[cron] [${ts()}] ■ Cron cycle FINISHED — exit ${code}, took ${min}m ${sec}s`);
    console.log(`[cron] [${ts()}]   Next run: ${new Date(Date.now() + cronState.intervalMs).toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit' })}`);
  });

  child.on('error', (err) => {
    clearTimeout(killTimer);
    cronState.running = false;
    cronState.childPid = null;
    console.log(`[cron] [${ts()}] ✗ Cron cycle ERROR — ${err.message}`);
  });
}

module.exports = { cronState, startCronTimer, stopCronTimer, fireCron };
