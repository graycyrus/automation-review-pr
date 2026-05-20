#!/usr/bin/env node
/**
 * GitHub sync worker — runs in a child process so it never blocks the Express server.
 * Spawned by github-sync.js via fork(). Communicates results back via IPC.
 *
 * Uses `gh pr list` in batches of 50 (limit 100 causes GitHub GraphQL 502s).
 */

const { execSync } = require('child_process');

const REPO = 'tinyhumansai/openhuman';
const BATCH_SIZE = 20;
const FIELDS = 'number,title,author,isDraft,reviewDecision,createdAt,updatedAt,headRefName,baseRefName,url,labels';

function exec(cmd, timeout = 30000) {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (err) {
    console.error(`[worker] Failed: ${cmd.slice(0, 120)}...`);
    console.error(`[worker] ${err.message.split('\n')[0]}`);
    return null;
  }
}

function ghJson(cmd, timeout) {
  const out = exec(cmd, timeout);
  if (!out) return null;
  try { return JSON.parse(out); } catch { return null; }
}

function run() {
  console.log(`[worker] Fetching open PRs from ${REPO}...`);

  // Fetch in batches of 30 (GitHub 502s above ~40 with these fields)
  const allRaw = [];
  let batchNum = 0;

  while (allRaw.length < 200) {
    batchNum++;
    let cmd = `gh pr list --repo ${REPO} --state open --limit ${BATCH_SIZE} --json ${FIELDS}`;

    // For subsequent batches, filter by created date before the oldest we've seen
    if (allRaw.length > 0) {
      const oldestDate = allRaw[allRaw.length - 1].createdAt;
      cmd += ` --search "created:<${oldestDate}"`;
    }

    const batch = ghJson(cmd);
    if (!batch) {
      if (allRaw.length === 0) {
        console.error('[worker] Failed to fetch PRs (batch 1)');
        process.send({ type: 'error', error: 'Failed to fetch PRs' });
        process.exit(1);
      }
      console.warn(`[worker] Batch ${batchNum} failed — continuing with ${allRaw.length} PRs`);
      break;
    }

    console.log(`[worker] Batch ${batchNum}: ${batch.length} PRs`);
    allRaw.push(...batch);

    // If we got fewer than BATCH_SIZE, we've fetched all open PRs
    if (batch.length < BATCH_SIZE) break;
  }

  // Dedup by PR number
  const seen = new Set();
  const prs = [];
  for (const pr of allRaw) {
    const num = pr.number;
    if (seen.has(num)) continue;
    seen.add(num);
    prs.push({
      number: num,
      title: pr.title,
      isDraft: pr.isDraft,
      reviewDecision: pr.reviewDecision,
      createdAt: pr.createdAt,
      updatedAt: pr.updatedAt,
      headRefName: pr.headRefName,
      baseRefName: pr.baseRefName,
      url: pr.url,
      author: pr.author ? { login: pr.author.login } : {},
      labels: (pr.labels || []),
      reviewRequests: [],
      assignees: [],
    });
  }

  console.log(`[worker] Total: ${prs.length} unique open PRs`);

  // Enrich non-draft PRs with diff stats + mergeable + CI checks
  const nonDraftPrs = prs.filter(p => !p.isDraft);
  console.log(`[worker] Enriching ${nonDraftPrs.length} non-draft PRs...`);

  for (const pr of nonDraftPrs) {
    // Diff stats + mergeable in one call
    try {
      const out = exec(
        `gh pr view ${pr.number} --repo ${REPO} --json additions,deletions,changedFiles,mergeable,mergeStateStatus`,
        10000
      );
      if (out) {
        const info = JSON.parse(out);
        pr.additions = info.additions;
        pr.deletions = info.deletions;
        pr.changedFiles = info.changedFiles;
        pr.mergeable = info.mergeable;
        pr.mergeStateStatus = info.mergeStateStatus;
      }
    } catch {}

    // CI checks
    try {
      const out = exec(
        `gh pr checks ${pr.number} --repo ${REPO} --json name,bucket,link,startedAt,completedAt,workflow`,
        10000
      );
      if (out) pr._ciChecks = JSON.parse(out);
    } catch {}
  }

  // Send results back to parent
  process.send({
    type: 'result',
    prs,
  });

  console.log(`[worker] Done — ${prs.length} PRs sent to parent`);
}

run();
