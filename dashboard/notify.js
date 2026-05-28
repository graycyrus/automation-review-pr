const https = require('https');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const PREFIX = '[PR Review Cron]';

function ts() {
  return new Date().toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit' });
}

function send(message) {
  if (!BOT_TOKEN || !CHAT_ID) return;

  const full = `<b>${PREFIX}</b> <i>${ts()}</i>\n${message}`;
  const payload = JSON.stringify({
    chat_id: CHAT_ID,
    text: full,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  });

  const req = https.request({
    hostname: 'api.telegram.org',
    path: `/bot${BOT_TOKEN}/sendMessage`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
  });

  req.on('error', () => {});
  req.write(payload);
  req.end();
}

const notify = {
  cronCycleStarted() {
    send(`🔄 <b>Cron cycle started</b>`);
  },

  cronEligible(prCount) {
    send(`🔍 <b>${prCount} eligible PR(s)</b> to review`);
  },

  cronFinished(discovered, reviewed, failed, duration) {
    const status = failed > 0 ? '⚠️' : '✅';
    send(`${status} <b>Cron finished</b>\nDiscovered: ${discovered} | Reviewed: ${reviewed} | Failed: ${failed}\nDuration: ${duration}`);
  },

  cronRateLimited() {
    send(`🚫 <b>Rate limited</b>\nClaude usage cap hit — cron stopped. Will retry next cycle.`);
  },

  cronError(error) {
    send(`❌ <b>Cron error</b>\n${error}`);
  },

  reviewStarted(prNumber, title, model) {
    send(`📝 <b>Reviewing PR #${prNumber}</b>\n${title}\nModel: ${model}`);
  },

  reviewCompleted(prNumber, decision, findings) {
    const icon = decision === 'APPROVE' ? '✅' : decision === 'REQUEST_CHANGES' ? '🔴' : '💬';
    send(`${icon} <b>PR #${prNumber}</b> → ${decision}\n${findings}`);
  },

  reviewFailed(prNumber, reason) {
    send(`❌ <b>PR #${prNumber} review failed</b>\n${reason}`);
  },

  merged(prNumber, title) {
    send(`🟣 <b>Merged PR #${prNumber}</b>\n${title}`);
  },

  judgeReport(reviewed, avgScore, patterns) {
    send(`🧑‍⚖️ <b>Judge report</b>\nReviewed: ${reviewed} | Avg quality: ${avgScore}/10\n${patterns || 'No new patterns found'}`);
  },

  schedulerToggled(active, interval) {
    send(active
      ? `▶️ <b>Scheduler activated</b> — every ${interval} min`
      : `⏹ <b>Scheduler deactivated</b>`);
  },
};

module.exports = notify;
