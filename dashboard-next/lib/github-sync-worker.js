#!/usr/bin/env node
/**
 * GitHub sync worker — runs in a child process so it never blocks the
 * Next.js server. Spawned by github-sync.js via fork(); reports back via IPC.
 *
 * Optimisation: a single `gh pr list` call now returns everything we need
 * including statusCheckRollup, additions/deletions, and mergeable state.
 * That replaced ~2 per-PR `gh pr view` + `gh pr checks` calls per PR, so
 * a full sync of ~100 PRs went from minutes to seconds.
 */

const { execSync } = require('child_process');

const REPO = 'tinyhumansai/openhuman';
const BATCH_SIZE = 20;

// All fields we want from the list call. statusCheckRollup gives us inline
// CI checks; additions/deletions/changedFiles/mergeable/mergeStateStatus
// give us the diff stats + merge state without a per-PR `gh pr view`.
const FIELDS = [
  'number', 'title', 'author', 'isDraft', 'reviewDecision',
  'createdAt', 'updatedAt', 'headRefName', 'baseRefName', 'url', 'labels',
  'additions', 'deletions', 'changedFiles', 'mergeable', 'mergeStateStatus',
  'statusCheckRollup', 'assignees',
].join(',');

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

// Map statusCheckRollup entries (GraphQL shape) to the same bucket-keyed
// shape that `gh pr checks` returned previously. Keeps downstream code in
// db.js + the UI unchanged.
function rollupToChecks(rollup) {
  if (!Array.isArray(rollup)) return [];
  return rollup.map((c) => {
    let bucket = 'pending';
    if (c.__typename === 'CheckRun') {
      if (c.status === 'COMPLETED') {
        switch (c.conclusion) {
          case 'SUCCESS':
          case 'NEUTRAL':
            bucket = 'pass';
            break;
          case 'SKIPPED':
            bucket = 'skipping';
            break;
          case 'CANCELLED':
            bucket = 'cancel';
            break;
          case 'FAILURE':
          case 'TIMED_OUT':
          case 'ACTION_REQUIRED':
          case 'STARTUP_FAILURE':
          case 'STALE':
            bucket = 'fail';
            break;
          default:
            bucket = 'pass';
        }
      } else if (c.status === 'QUEUED' || c.status === 'WAITING') {
        bucket = 'queued';
      } else {
        bucket = 'pending';
      }
      return {
        name: c.name,
        bucket,
        link: c.detailsUrl,
        startedAt: c.startedAt,
        completedAt: c.completedAt,
        workflow: c.workflowName,
      };
    }
    // StatusContext (older API used by some external CIs)
    if (c.__typename === 'StatusContext') {
      switch (c.state) {
        case 'SUCCESS': bucket = 'pass'; break;
        case 'ERROR':
        case 'FAILURE': bucket = 'fail'; break;
        case 'PENDING':
        default: bucket = 'pending';
      }
      return {
        name: c.context,
        bucket,
        link: c.targetUrl,
        startedAt: c.createdAt,
        completedAt: c.createdAt,
        workflow: '',
      };
    }
    return { name: 'unknown', bucket: 'pending', link: '', startedAt: '', completedAt: '', workflow: '' };
  });
}

function run() {
  console.log(`[worker] Fetching open PRs from ${REPO}...`);

  const allRaw = [];
  let batchNum = 0;

  while (allRaw.length < 200) {
    batchNum++;
    let cmd = `gh pr list --repo ${REPO} --state open --limit ${BATCH_SIZE} --json ${FIELDS}`;
    if (allRaw.length > 0) {
      const oldestDate = allRaw[allRaw.length - 1].createdAt;
      cmd += ` --search "created:<${oldestDate}"`;
    }

    const batch = ghJson(cmd, 45000);
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
    if (batch.length < BATCH_SIZE) break;
  }

  const seen = new Set();
  const prs = [];
  for (const pr of allRaw) {
    if (seen.has(pr.number)) continue;
    seen.add(pr.number);
    prs.push({
      number: pr.number,
      title: pr.title,
      isDraft: pr.isDraft,
      reviewDecision: pr.reviewDecision,
      createdAt: pr.createdAt,
      updatedAt: pr.updatedAt,
      headRefName: pr.headRefName,
      baseRefName: pr.baseRefName,
      url: pr.url,
      author: pr.author ? { login: pr.author.login } : {},
      labels: pr.labels || [],
      reviewRequests: [],
      assignees: pr.assignees || [],
      additions: pr.additions || 0,
      deletions: pr.deletions || 0,
      changedFiles: pr.changedFiles || 0,
      mergeable: pr.mergeable || null,
      mergeStateStatus: pr.mergeStateStatus || null,
      _ciChecks: rollupToChecks(pr.statusCheckRollup),
    });
  }

  console.log(`[worker] Total: ${prs.length} unique open PRs (single-call enrichment)`);
  process.send({ type: 'result', prs });
}

run();
