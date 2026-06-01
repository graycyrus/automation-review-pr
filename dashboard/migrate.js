const path = require('path');
const db = require('./db');
const { scanTrackingDir, scanLogsDir } = require('./parser');

const BASE_DIR = path.resolve(__dirname, '..');
const TRACKING_DIR = path.join(BASE_DIR, 'tinyhumansai-openhuman');
const APPROVED_DIR = path.join(BASE_DIR, 'to-be-approved');
const FULLY_APPROVED_DIR = path.join(BASE_DIR, 'approved');
const TO_BE_CLOSED_DIR = path.join(BASE_DIR, 'to-be-closed');
const MERGED_DIR = path.join(BASE_DIR, 'already-merged');
const LOGS_DIR = path.join(BASE_DIR, 'logs');

function migrate() {
  console.log('[migrate] Seeding database from existing tracking files...');

  // Parse all tracking files
  const trackingPrs = scanTrackingDir(TRACKING_DIR, 'tinyhumansai-openhuman');
  const approvedPrs = scanTrackingDir(APPROVED_DIR, 'to-be-approved');
  const fullyApprovedPrs = scanTrackingDir(FULLY_APPROVED_DIR, 'approved');
  const toBeClosedPrs = scanTrackingDir(TO_BE_CLOSED_DIR, 'to-be-closed');
  const allPrs = [...trackingPrs, ...approvedPrs, ...fullyApprovedPrs, ...toBeClosedPrs];

  console.log(`[migrate] Found ${allPrs.length} PR tracking files`);

  for (const { pr, cycles } of allPrs) {
    if (!pr.id) continue;

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
      tracking_file_path: pr.tracking_file_path,
      location: pr.location,
      ai_summary: pr.ai_summary || null,
      ai_summary_what: pr.ai_summary_what || null,
      ai_summary_breaking_risk: pr.ai_summary_breaking_risk || null,
      ai_summary_security_risk: pr.ai_summary_security_risk || null,
      ai_summary_bottom_line: pr.ai_summary_bottom_line || null,
      ai_slop_detected: pr.ai_slop_detected || null,
      ai_slop_structural: pr.ai_slop_structural || null,
      ai_slop_content: pr.ai_slop_content || null,
      ai_slop_behavioral: pr.ai_slop_behavioral || null,
      ui_visual_change: pr.ui_visual_change || null,
      ui_user_flow: pr.ui_user_flow || null,
      ui_affected_surfaces: pr.ui_affected_surfaces || null,
      ui_risk: pr.ui_risk || null,
      ui_recommendation: pr.ui_recommendation || null,
    });

    if (cycles.length > 0) {
      db.replaceCyclesForPr(pr.id, cycles);
    }

    if (pr.ai_summary) {
      db.updatePrSummary(pr.id, pr.ai_summary);
    }

    console.log(`[migrate]   PR #${pr.id}: ${cycles.length} cycle(s) — ${pr.status}`);
  }

  // Parse cron logs
  const cronRuns = scanLogsDir(LOGS_DIR);
  console.log(`[migrate] Found ${cronRuns.length} cron log files`);

  for (const run of cronRuns) {
    db.insertCronRun(run);
  }

  console.log('[migrate] Done.');
}

if (require.main === module) {
  migrate();
  db.close();
} else {
  module.exports = { migrate };
}
