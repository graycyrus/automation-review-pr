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
    console.log(`[cron] [${ts()}] ⏭ Skipping — previous run still active (started ${cronState.lastRun})`);
    return;
  }
  cronState.running = true;
  cronState.lastRun = new Date().toISOString();
  const nextAt = new Date(Date.now() + cronState.intervalMs);
  cronState.nextRun = nextAt.toISOString();

  console.log(`[cron] [${ts()}] ▶ Cron cycle STARTED`);
  console.log(`[cron] [${ts()}]   Next run after this: ${nextAt.toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit' })}`);

  const startTime = Date.now();

  const child = spawn('bash', [CRON_SCRIPT], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

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
    cronState.running = false;
    const duration = Math.round((Date.now() - startTime) / 1000);
    const min = Math.floor(duration / 60);
    const sec = duration % 60;
    console.log(`[cron] [${ts()}] ■ Cron cycle FINISHED — exit ${code}, took ${min}m ${sec}s`);
    console.log(`[cron] [${ts()}]   Next run: ${new Date(Date.now() + cronState.intervalMs).toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit' })}`);
  });
}

module.exports = { cronState, startCronTimer, stopCronTimer, fireCron };
