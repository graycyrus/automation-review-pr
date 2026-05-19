const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const db = require('./db');

const REPO = 'tinyhumansai/openhuman';
const BASE_DIR = path.resolve(__dirname, '..');
const MERGED_DIR = path.join(BASE_DIR, 'already-merged');
const SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

let _orgMembers = null;
let _orgMembersFetchedAt = 0;
const ORG_CACHE_TTL = 60 * 60 * 1000; // 1 hour

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

function ghText(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

function fetchOrgMembers() {
  const now = Date.now();
  if (_orgMembers && (now - _orgMembersFetchedAt) < ORG_CACHE_TTL) {
    return _orgMembers;
  }

  const members = ghText(`gh api orgs/tinyhumansai/members --jq '.[].login'`);
  if (members) {
    _orgMembers = new Set(members.split('\n').map(s => s.trim().toLowerCase()).filter(Boolean));
    _orgMembersFetchedAt = now;
    console.log(`[github-sync] Cached ${_orgMembers.size} org members`);
  } else {
    _orgMembers = _orgMembers || new Set();
  }
  return _orgMembers;
}

function isMember(login) {
  if (!login) return null;
  const members = fetchOrgMembers();
  return members.has(login.toLowerCase()) ? 1 : 0;
}

/**
 * Handle a PR that has been merged.
 * 1. Update status to 'merged'
 * 2. Set is_open = 0
 * 3. Move tracking file to already-merged/
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

  // Already in the right place
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

function fetchAllOpenPrs() {
  console.log(`[github-sync] Fetching open PRs from ${REPO}...`);

  // Paginated fetch — gh pr list with 200 causes GitHub GraphQL 502s on large repos
  // Use gh api graphql with cursor-based pagination in batches of 50
  const PAGE_SIZE = 50;
  const prs = [];

  let cursor = null;
  let hasNext = true;

  while (hasNext && prs.length < 200) {
    const afterClause = cursor ? `, after: \\"${cursor}\\"` : '';
    const query = `query { repository(owner: \\"tinyhumansai\\", name: \\"openhuman\\") { pullRequests(first: ${PAGE_SIZE}, states: OPEN, orderBy: {field: CREATED_AT, direction: DESC}${afterClause}) { pageInfo { hasNextPage endCursor } nodes { number title isDraft reviewDecision createdAt updatedAt headRefName baseRefName url author { login } labels(first: 10) { nodes { name } } reviewRequests(first: 10) { nodes { requestedReviewer { ... on User { login } ... on Team { slug } } } } assignees(first: 10) { nodes { login } } } } } }`;

    const batch = ghJson(`gh api graphql -f query="${query}"`);
    if (!batch) {
      if (prs.length === 0) {
        console.error('[github-sync] Failed to fetch PRs');
        return;
      }
      console.warn(`[github-sync] Partial fetch — got ${prs.length} PRs before failure`);
      break;
    }

    const prData = batch?.data?.repository?.pullRequests;
    if (!prData || !prData.nodes) break;

    for (const node of prData.nodes) {
      prs.push({
        number: node.number,
        title: node.title,
        isDraft: node.isDraft,
        reviewDecision: node.reviewDecision,
        createdAt: node.createdAt,
        updatedAt: node.updatedAt,
        headRefName: node.headRefName,
        baseRefName: node.baseRefName,
        url: node.url,
        author: node.author ? { login: node.author.login } : {},
        labels: (node.labels?.nodes || []).map(l => ({ name: l.name })),
        reviewRequests: (node.reviewRequests?.nodes || []).map(r => r.requestedReviewer || {}),
        assignees: (node.assignees?.nodes || []),
      });
    }

    hasNext = prData.pageInfo.hasNextPage;
    cursor = prData.pageInfo.endCursor;
    console.log(`[github-sync]   Fetched page: ${prs.length} PRs so far...`);
  }

  // Enrich each PR with diff stats (additions/deletions/changedFiles) via per-PR view
  console.log(`[github-sync] Enriching ${prs.length} PRs with diff stats...`);
  for (const pr of prs) {
    try {
      const out = execSync(
        `gh pr view ${pr.number} --repo ${REPO} --json additions,deletions,changedFiles`,
        { encoding: 'utf-8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] }
      );
      const diff = JSON.parse(out);
      pr.additions = diff.additions;
      pr.deletions = diff.deletions;
      pr.changedFiles = diff.changedFiles;
    } catch {
      pr.additions = 0;
      pr.deletions = 0;
      pr.changedFiles = 0;
    }
  }

  // Fetch mergeable status for non-draft PRs only (requires per-PR GitHub computation)
  const nonDraftPrs = prs.filter(p => !p.isDraft);
  console.log(`[github-sync] Fetching merge status for ${nonDraftPrs.length} non-draft PRs...`);
  for (const pr of nonDraftPrs) {
    try {
      const out = execSync(
        `gh pr view ${pr.number} --repo ${REPO} --json mergeable,mergeStateStatus`,
        { encoding: 'utf-8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] }
      );
      const mergeInfo = JSON.parse(out);
      pr.mergeable = mergeInfo.mergeable;
      pr.mergeStateStatus = mergeInfo.mergeStateStatus;
    } catch {
      // Skip silently — merge info is optional
    }
  }

  // Fetch CI checks for non-draft PRs
  console.log(`[github-sync] Fetching CI checks for ${nonDraftPrs.length} non-draft PRs...`);
  for (const pr of nonDraftPrs) {
    try {
      const out = execSync(
        `gh pr checks ${pr.number} --repo ${REPO} --json name,bucket,link,startedAt,completedAt,workflow`,
        { encoding: 'utf-8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] }
      );
      pr._ciChecks = JSON.parse(out);
    } catch {
      // No checks or error — skip
    }
  }

  console.log(`[github-sync] Fetched ${prs.length} open PRs`);

  const existingPrs = new Map();
  for (const row of db.getAllPrs()) {
    existingPrs.set(row.id, row);
  }

  for (const pr of prs) {
    const authorLogin = pr.author?.login || '';
    const member = isMember(authorLogin);
    const existing = existingPrs.get(pr.number);

    // Determine status: preserve review status if we have one, otherwise derive from GH data
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

    // Compute CI summary
    const checks = pr._ciChecks || [];
    const ciTotal = checks.length;
    const ciPass = checks.filter(c => c.bucket === 'pass').length;
    const ciFail = checks.filter(c => c.bucket === 'fail').length;
    const ciPending = checks.filter(c => c.bucket === 'pending' || c.bucket === 'queued').length;

    // Store extended GitHub metadata
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

  // Find PRs that were open before but are no longer in the open list
  const openIds = new Set(prs.map(p => p.number));
  const previouslyOpen = db.getAllPrs().filter(p => {
    return !openIds.has(p.id) && p.status !== 'merged' && p.status !== 'closed';
  });

  // Detect merged/closed PRs and handle them
  for (const pr of previouslyOpen) {
    try {
      const out = execSync(
        `gh pr view ${pr.id} --repo ${REPO} --json state`,
        { encoding: 'utf-8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] }
      );
      const info = JSON.parse(out);
      if (info.state === 'MERGED') {
        handlePrMerged(pr.id);
      } else if (info.state === 'CLOSED') {
        handlePrClosed(pr.id);
      }
    } catch {
      // Can't fetch — skip
    }
  }

  db.markClosedPrs(prs.map(p => p.number));

  console.log(`[github-sync] Sync complete: ${prs.length} open PRs + ${previouslyOpen.length} closed/merged checked`);
}

let _interval = null;

function startPeriodicSync() {
  // Initial sync
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
 * Returns the updated PR data or throws on failure.
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

  // Handle merged/closed
  if (pr.state === 'MERGED') { handlePrMerged(prId); }
  if (pr.state === 'CLOSED') { handlePrClosed(prId); }

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

  // CI checks
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
  fetchOrgMembers,
  isMember,
  handlePrMerged,
  handlePrClosed,
  startPeriodicSync,
  stopPeriodicSync,
};
