import { NextRequest, NextResponse } from 'next/server';
import { execSync } from 'child_process';
import { db, githubSync } from '@/lib/server-deps';

export const dynamic = 'force-dynamic';

const REPO = 'tinyhumansai/openhuman';

// Per-PR refresh — only the data the Checks panel actually reads, so this
// stays cheap even if the user clicks reload aggressively. Mirrors the
// shape produced by the worker so the DB stays in one canonical format.
async function refreshSinglePr(id: number) {
  const out = execSync(
    `gh pr view ${id} --repo ${REPO} --json additions,deletions,changedFiles,mergeable,mergeStateStatus,statusCheckRollup,isDraft,reviewDecision,updatedAt,labels,assignees`,
    { encoding: 'utf-8', timeout: 20000, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  const info = JSON.parse(out);

  // Reuse the worker's bucket mapping. Easier to inline a small copy than
  // require() into this Edge-built file.
  const rollupToChecks = (rollup: any[]): any[] => {
    if (!Array.isArray(rollup)) return [];
    return rollup.map((c) => {
      let bucket = 'pending';
      if (c.__typename === 'CheckRun') {
        if (c.status === 'COMPLETED') {
          switch (c.conclusion) {
            case 'SUCCESS':
            case 'NEUTRAL': bucket = 'pass'; break;
            case 'SKIPPED': bucket = 'skipping'; break;
            case 'CANCELLED': bucket = 'cancel'; break;
            case 'FAILURE':
            case 'TIMED_OUT':
            case 'ACTION_REQUIRED':
            case 'STARTUP_FAILURE':
            case 'STALE': bucket = 'fail'; break;
            default: bucket = 'pass';
          }
        } else if (c.status === 'QUEUED' || c.status === 'WAITING') bucket = 'queued';
        else bucket = 'pending';
        return { name: c.name, bucket, link: c.detailsUrl, startedAt: c.startedAt, completedAt: c.completedAt, workflow: c.workflowName };
      }
      if (c.__typename === 'StatusContext') {
        switch (c.state) {
          case 'SUCCESS': bucket = 'pass'; break;
          case 'ERROR':
          case 'FAILURE': bucket = 'fail'; break;
          default: bucket = 'pending';
        }
        return { name: c.context, bucket, link: c.targetUrl, startedAt: c.createdAt, completedAt: c.createdAt, workflow: '' };
      }
      return { name: 'unknown', bucket: 'pending', link: '', startedAt: '', completedAt: '', workflow: '' };
    });
  };

  const checks = rollupToChecks(info.statusCheckRollup);
  const ciTotal = checks.length;
  const ciPass = checks.filter((c: any) => c.bucket === 'pass').length;
  const ciFail = checks.filter((c: any) => c.bucket === 'fail').length;
  const ciPending = checks.filter((c: any) => c.bucket === 'pending' || c.bucket === 'queued').length;

  db.upsertPrGithub({
    pr_id: id,
    is_draft: info.isDraft ? 1 : 0,
    review_decision: info.reviewDecision || null,
    mergeable: info.mergeable || null,
    merge_state_status: info.mergeStateStatus || null,
    additions: info.additions || 0,
    deletions: info.deletions || 0,
    changed_files: info.changedFiles || 0,
    labels: (info.labels || []).map((l: any) => l.name).join(', '),
    reviewers: '',
    assignees: (info.assignees || []).map((a: any) => a.login).join(', '),
    updated_at_gh: info.updatedAt,
    last_synced: new Date().toISOString(),
    ci_checks: ciTotal > 0 ? JSON.stringify(checks) : null,
    ci_total: ciTotal,
    ci_pass: ciPass,
    ci_fail: ciFail,
    ci_pending: ciPending,
  });

  return { checks, total: ciTotal, pass: ciPass, fail: ciFail, pending: ciPending };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  const pr = db.getPrByIdFull(id);
  if (!pr) return NextResponse.json({ error: 'PR not found' }, { status: 404 });

  // ?refresh=1 forces a single-PR re-fetch from gh (writes the DB and
  // returns fresh data). Without it we serve the cached worker snapshot.
  if (req.nextUrl.searchParams.get('refresh') === '1') {
    try {
      const fresh = await refreshSinglePr(id);
      return NextResponse.json({ ...fresh, refreshed: true });
    } catch (err: any) {
      console.warn(`[checks] refresh failed for PR #${id}: ${err.message} — falling back to cache`);
    }
  }

  let checks: any[] = [];
  if (pr.ci_checks) {
    try { checks = JSON.parse(pr.ci_checks); } catch {}
  }

  return NextResponse.json({
    total: pr.ci_total || 0,
    pass: pr.ci_pass || 0,
    fail: pr.ci_fail || 0,
    pending: pr.ci_pending || 0,
    checks,
    refreshed: false,
  });
}
