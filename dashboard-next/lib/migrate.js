const path = require('path');
const db = require('./db');
const { scanTrackingDir, scanLogsDir } = require('./parser');

const BASE_DIR = path.resolve(process.cwd(), '..');
const TRACKING_DIR = path.join(BASE_DIR, 'tinyhumansai-openhuman');
const APPROVED_DIR = path.join(BASE_DIR, 'to-be-approved');
const FULLY_APPROVED_DIR = path.join(BASE_DIR, 'approved');
const MERGED_DIR = path.join(BASE_DIR, 'already-merged');
const LOGS_DIR = path.join(BASE_DIR, 'logs');

function migrate() {
  console.log('[migrate] Seeding database from existing tracking files...');

  // Parse all tracking files
  const trackingPrs = scanTrackingDir(TRACKING_DIR, 'tinyhumansai-openhuman');
  const approvedPrs = scanTrackingDir(APPROVED_DIR, 'to-be-approved');
  const fullyApprovedPrs = scanTrackingDir(FULLY_APPROVED_DIR, 'approved');
  const mergedPrs = scanTrackingDir(MERGED_DIR, 'already-merged');
  const allPrs = [...trackingPrs, ...approvedPrs, ...fullyApprovedPrs, ...mergedPrs];

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
    });

    if (cycles.length > 0) {
      db.replaceCyclesForPr(pr.id, cycles);
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
