const { spawn } = require('child_process');
const path = require('path');

const CRON_SCRIPT = path.join(__dirname, '..', 'cron-pr-review.sh');

const cronState = {
  active: false,
  intervalMs: 0,
  timer: null,
  lastRun: null,
  running: false,
};

function startCronTimer() {
  if (cronState.timer) clearInterval(cronState.timer);
  if (!cronState.intervalMs || cronState.intervalMs < 5 * 60 * 1000) return;
  cronState.active = true;
  console.log(`[cron] Scheduler started — every ${cronState.intervalMs / 60000} min`);
  cronState.timer = setInterval(fireCron, cronState.intervalMs);
}

function stopCronTimer() {
  if (cronState.timer) clearInterval(cronState.timer);
  cronState.timer = null;
  cronState.active = false;
  console.log('[cron] Scheduler stopped');
}

function fireCron() {
  if (cronState.running) {
    console.log('[cron] Skipping — previous run still active');
    return;
  }
  cronState.running = true;
  cronState.lastRun = new Date().toISOString();
  console.log(`[cron] Firing at ${cronState.lastRun}`);

  const child = spawn('bash', [CRON_SCRIPT], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (d) => process.stdout.write(`[cron] ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`[cron:err] ${d}`));

  child.on('close', (code) => {
    cronState.running = false;
    console.log(`[cron] Finished with code ${code}`);
  });
}

module.exports = { cronState, startCronTimer, stopCronTimer, fireCron };
