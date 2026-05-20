const { execSync, fork } = require('child_process');
const fs = require('fs');
const path = require('path');
const db = require('./db');

const REPO = 'tinyhumansai/openhuman';
const BASE_DIR = path.resolve(process.cwd(), '..');
const MERGED_DIR = path.join(BASE_DIR, 'already-merged');
const WORKER_PATH = path.join(process.cwd(), 'lib', 'github-sync-worker.js');
const SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes — keeps mergeable/CI/review_decision fresh

// Hardcoded org members — update manually when team changes
const ORG_MEMBERS = new Set([
  'al629176', 'codeghost21', 'giri-aayush', 'graycyrus',
  'm3ga-mind', 'oxoxdev', 'sanil-23', 'senamakel', 'yellowsnnowmann',
]);

let _syncing = false; // prevent overlapping syncs

function ghJson(cmd) {
  try {
    const out = execSync(cmd, { encoding: 'utf-8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] });
    return JSON.parse(out);
  } catch (err) {
    console.error(`[github-sync] Command failed: ${cmd}`);
    console.error(`[github-sync] ${err.message}`);
    return null;
  }
}

function isMember(login) {
  if (!login) return null;
  return ORG_MEMBERS.has(login.toLowerCase()) ? 1 : 0;
}

/**
 * Handle a PR that has been merged.
 */
function handlePrMerged(prId) {
  db.updatePrStatus(prId, 'merged');
  db.markPrNotOpen(prId);
  moveTrackingFile(prId);
  console.log(`[github-sync]   PR #${prId}: merged — archived`);
}

/**
 * Handle a PR that has been closed (not merged).
 */
function handlePrClosed(prId) {
  db.updatePrStatus(prId, 'closed');
  db.markPrNotOpen(prId);
  moveTrackingFile(prId);
  console.log(`[github-sync]   PR #${prId}: closed — archived`);
}

/**
 * Move a PR's tracking file to already-merged/ directory.
 */
function moveTrackingFile(prId) {
  const pr = db.getPrById(prId);
  if (!pr || !pr.tracking_file_path) return;
  if (!fs.existsSync(pr.tracking_file_path)) return;
  if (pr.tracking_file_path.includes('already-merged')) return;

  fs.mkdirSync(MERGED_DIR, { recursive: true });
  const filename = path.basename(pr.tracking_file_path);
  const newPath = path.join(MERGED_DIR, filename);

  try {
    fs.renameSync(pr.tracking_file_path, newPath);
    db.updatePrTrackingPath(prId, newPath, 'already-merged');
  } catch (err) {
    console.error(`[github-sync]   Failed to move ${filename}: ${err.message}`);
  }
}

/**
 * Process results from the worker — runs on the main thread but only does
 * fast DB writes (no network I/O), so it doesn't block meaningfully.
 */
function processWorkerResults(prs) {
  const existingPrs = new Map();
  for (const row of db.getAllPrs()) {
    existingPrs.set(row.id, row);
  }

  for (const pr of prs) {
    const authorLogin = pr.author?.login || '';
    const member = isMember(authorLogin);
    const existing = existingPrs.get(pr.number);

    let status = 'pending';
    if (existing && existing.status && existing.status !== 'pending') {
      status = existing.status;
    } else if (pr.reviewDecision === 'CHANGES_REQUESTED') {
      status = 'changes-requested';
    } else if (pr.reviewDecision === 'APPROVED') {
      status = 'clean';
    }

    const labels = (pr.labels || []).map(l => l.name).join(', ');
    const reviewers = (pr.reviewRequests || []).map(r => r.name || r.login || r.slug || '').join(', ');
    const assignees = (pr.assignees || []).map(a => a.login || '').join(', ');

    db.upsertPr({
      id: pr.number,
      title: pr.title,
      author: authorLogin,
      branch: pr.headRefName,
      base_branch: pr.baseRefName || 'main',
      url: pr.url,
      created_at: pr.createdAt,
      status,
      is_member: member,
      last_reviewed_commit: existing?.last_reviewed_commit || null,
      last_review_date: existing?.last_review_date || null,
      tracking_file_path: existing?.tracking_file_path || null,
      location: existing?.location || null,
    });

    const checks = pr._ciChecks || [];
    const ciTotal = checks.length;
    const ciPass = checks.filter(c => c.bucket === 'pass').length;
    const ciFail = checks.filter(c => c.bucket === 'fail').length;
    const ciPending = checks.filter(c => c.bucket === 'pending' || c.bucket === 'queued').length;

    db.upsertPrGithub({
      pr_id: pr.number,
      is_draft: pr.isDraft ? 1 : 0,
      review_decision: pr.reviewDecision || null,
      mergeable: pr.mergeable || null,
      merge_state_status: pr.mergeStateStatus || null,
      additions: pr.additions || 0,
      deletions: pr.deletions || 0,
      changed_files: pr.changedFiles || 0,
      labels,
      reviewers,
      assignees,
      updated_at_gh: pr.updatedAt,
      last_synced: new Date().toISOString(),
      ci_checks: ciTotal > 0 ? JSON.stringify(checks) : null,
      ci_total: ciTotal,
      ci_pass: ciPass,
      ci_fail: ciFail,
      ci_pending: ciPending,
    });
  }

  // Detect merged/closed PRs
  const openIds = new Set(prs.map(p => p.number));
  const previouslyOpen = db.getAllPrs().filter(p => {
    return !openIds.has(p.id) && p.status !== 'merged' && p.status !== 'closed';
  });

  // Check each previously-open PR — these are few, so sync is fine
  for (const pr of previouslyOpen) {
    try {
      const out = execSync(
        `gh pr view ${pr.id} --repo ${REPO} --json state`,
        { encoding: 'utf-8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] }
      );
      const info = JSON.parse(out);
      if (info.state === 'MERGED') handlePrMerged(pr.id);
      else if (info.state === 'CLOSED') handlePrClosed(pr.id);
    } catch {}
  }

  db.markClosedPrs(prs.map(p => p.number));

  console.log(`[github-sync] Sync complete: ${prs.length} open PRs + ${previouslyOpen.length} closed/merged checked`);
}

/**
 * Spawn the worker process to fetch all open PRs.
 * Non-blocking — the worker runs in a child process.
 */
function fetchAllOpenPrs() {
  if (_syncing) {
    console.log('[github-sync] Sync already in progress — skipping');
    return;
  }

  _syncing = true;
  console.log('[github-sync] Spawning worker to fetch open PRs...');

  const worker = fork(WORKER_PATH, [], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });

  // Forward worker logs to server console
  worker.stdout.on('data', (data) => process.stdout.write(data));
  worker.stderr.on('data', (data) => process.stderr.write(data));

  worker.on('message', (msg) => {
    if (msg.type === 'result') {
      try {
        processWorkerResults(msg.prs);
      } catch (err) {
        console.error(`[github-sync] Error processing worker results: ${err.message}`);
      }
    } else if (msg.type === 'error') {
      console.error(`[github-sync] Worker error: ${msg.error}`);
    }
  });

  worker.on('exit', (code) => {
    _syncing = false;
    if (code !== 0 && code !== null) {
      console.error(`[github-sync] Worker exited with code ${code}`);
    }
  });

  worker.on('error', (err) => {
    _syncing = false;
    console.error(`[github-sync] Worker failed to start: ${err.message}`);
  });
}

let _interval = null;

function startPeriodicSync() {
  // Initial sync (non-blocking)
  fetchAllOpenPrs();

  // Repeat every 5 min
  _interval = setInterval(() => {
    fetchAllOpenPrs();
  }, SYNC_INTERVAL_MS);

  console.log(`[github-sync] Periodic sync every ${SYNC_INTERVAL_MS / 1000}s`);
}

function stopPeriodicSync() {
  if (_interval) {
    clearInterval(_interval);
    _interval = null;
  }
}

/**
 * Fetch and sync a single PR from GitHub API + tracking file.
 * This is fast enough to run synchronously (1 PR = 2-3 API calls).
 */
function fetchSinglePr(prId) {
  console.log(`[github-sync] Fetching single PR #${prId} from ${REPO}...`);

  const fields = [
    'number', 'title', 'author', 'labels', 'isDraft',
    'reviewDecision', 'createdAt', 'updatedAt', 'state',
    'headRefName', 'baseRefName', 'url',
    'additions', 'deletions', 'changedFiles',
    'reviewRequests', 'assignees',
  ].join(',');

  const pr = ghJson(`gh pr view ${prId} --repo ${REPO} --json ${fields},mergeable,mergeStateStatus`);
  if (!pr) throw new Error(`Failed to fetch PR #${prId} from GitHub`);

  if (pr.state === 'MERGED') handlePrMerged(prId);
  if (pr.state === 'CLOSED') handlePrClosed(prId);

  const authorLogin = pr.author?.login || '';
  const member = isMember(authorLogin);
  const existing = db.getPrById(prId);

  let status = 'pending';
  if (existing && existing.status && existing.status !== 'pending') {
    status = existing.status;
  } else if (pr.reviewDecision === 'CHANGES_REQUESTED') {
    status = 'changes-requested';
  } else if (pr.reviewDecision === 'APPROVED') {
    status = 'clean';
  }
  if (pr.state === 'MERGED') status = 'merged';
  if (pr.state === 'CLOSED') status = 'closed';

  const labels = (pr.labels || []).map(l => l.name).join(', ');
  const reviewers = (pr.reviewRequests || []).map(r => r.name || r.login || r.slug || '').join(', ');
  const assignees = (pr.assignees || []).map(a => a.login || '').join(', ');

  db.upsertPr({
    id: prId,
    title: pr.title,
    author: authorLogin,
    branch: pr.headRefName,
    base_branch: pr.baseRefName || 'main',
    url: pr.url,
    created_at: pr.createdAt,
    status,
    is_member: member,
    last_reviewed_commit: existing?.last_reviewed_commit || null,
    last_review_date: existing?.last_review_date || null,
    tracking_file_path: existing?.tracking_file_path || null,
    location: existing?.location || null,
  });

  let checks = [];
  if (!pr.isDraft) {
    try {
      const out = execSync(
        `gh pr checks ${prId} --repo ${REPO} --json name,bucket,link,startedAt,completedAt,workflow`,
        { encoding: 'utf-8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] }
      );
      checks = JSON.parse(out);
    } catch {}
  }

  const ciTotal = checks.length;
  const ciPass = checks.filter(c => c.bucket === 'pass').length;
  const ciFail = checks.filter(c => c.bucket === 'fail').length;
  const ciPending = checks.filter(c => c.bucket === 'pending' || c.bucket === 'queued').length;

  db.upsertPrGithub({
    pr_id: prId,
    is_draft: pr.isDraft ? 1 : 0,
    review_decision: pr.reviewDecision || null,
    mergeable: pr.mergeable || null,
    merge_state_status: pr.mergeStateStatus || null,
    additions: pr.additions || 0,
    deletions: pr.deletions || 0,
    changed_files: pr.changedFiles || 0,
    labels,
    reviewers,
    assignees,
    updated_at_gh: pr.updatedAt,
    last_synced: new Date().toISOString(),
    ci_checks: ciTotal > 0 ? JSON.stringify(checks) : null,
    ci_total: ciTotal,
    ci_pass: ciPass,
    ci_fail: ciFail,
    ci_pending: ciPending,
  });

  console.log(`[github-sync] Synced PR #${prId}`);
  return db.getPrByIdFull(prId);
}

module.exports = {
  fetchAllOpenPrs,
  fetchSinglePr,
  isMember,
  handlePrMerged,
  handlePrClosed,
  startPeriodicSync,
  stopPeriodicSync,
};
