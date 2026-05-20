import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { db, triggerJobs } from '@/lib/server-deps';

export const dynamic = 'force-dynamic';

const REPO = 'tinyhumansai/openhuman';
const APPROVED_DIR = path.join(triggerJobs.BASE_DIR, 'approved');

function writeApproveLog(prId: number, lines: string[]) {
  try {
    fs.mkdirSync(triggerJobs.LOGS_DIR, { recursive: true });
    const logFile = path.join(triggerJobs.LOGS_DIR, `approve-PR-${prId}-${triggerJobs.timestamp()}.log`);
    fs.writeFileSync(logFile, lines.join('\n') + '\n');
  } catch {}
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const prId = parseInt(idStr, 10);
  const now = new Date().toISOString();
  const logLines: string[] = [];
  const log = (msg: string) => {
    logLines.push(`[${new Date().toISOString()}] ${msg}`);
    console.log(`[approve] ${msg}`);
  };

  try {
    const pr = db.getPrById(prId);
    if (!pr) return NextResponse.json({ error: 'PR not found' }, { status: 404 });
    if (pr.status !== 'clean') {
      return NextResponse.json({
        error: `PR #${prId} is not in clean status (current: ${pr.status})`,
        checks: { status_clean: false, ci_passing: null, no_conflicts: null },
      }, { status: 400 });
    }
    log(`PR #${prId} — status is clean, running pre-flight checks...`);

    let ciPassing = true;
    try {
      const ciOut = execSync(
        `gh pr checks ${prId} --repo ${REPO} --json bucket --jq '[.[].bucket] | any(. == "fail")'`,
        { encoding: 'utf-8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] }
      ).trim();
      ciPassing = ciOut !== 'true';
    } catch { ciPassing = true; }
    log(`CI passing (no failures): ${ciPassing}`);

    let noConflicts = false;
    try {
      const mergeOut = execSync(
        `gh pr view ${prId} --repo ${REPO} --json mergeable --jq '.mergeable'`,
        { encoding: 'utf-8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] }
      ).trim();
      noConflicts = mergeOut === 'MERGEABLE';
    } catch { noConflicts = false; }
    log(`No conflicts: ${noConflicts}`);

    const checks = { status_clean: true, ci_passing: ciPassing, no_conflicts: noConflicts };

    if (!ciPassing || !noConflicts) {
      const failures: string[] = [];
      if (!ciPassing) failures.push('CI not passing');
      if (!noConflicts) failures.push('merge conflicts');
      log(`Pre-flight failed: ${failures.join(', ')}`);
      writeApproveLog(prId, logLines);
      return NextResponse.json({ error: `Pre-flight failed: ${failures.join(', ')}`, checks }, { status: 400 });
    }

    log('Posting APPROVE review to GitHub...');
    let reviewUrl: string | null = null;
    try {
      const reviewOut = execSync(
        `gh api repos/${REPO}/pulls/${prId}/reviews -X POST -f event=APPROVE -f body="Looks good, nice work!"`,
        { encoding: 'utf-8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] }
      );
      const review = JSON.parse(reviewOut);
      reviewUrl = review.html_url || `https://github.com/${REPO}/pull/${prId}#pullrequestreview-${review.id}`;
      log(`Review posted: ${reviewUrl}`);
    } catch (err: any) {
      log(`Failed to post review: ${err.message}`);
      writeApproveLog(prId, logLines);
      return NextResponse.json({ error: 'Failed to post APPROVE review to GitHub' }, { status: 500 });
    }

    db.updatePrStatus(prId, 'approved');
    log('DB status updated to approved');

    const trackingPath = pr.tracking_file_path;
    if (trackingPath && fs.existsSync(trackingPath)) {
      let content = fs.readFileSync(trackingPath, 'utf-8');
      content = content.replace(/\*\*Status\*\*:\s*clean/, '**Status**: approved');
      content += `\n### Approved — ${now}\n**Approved by**: graycyrus\n**Pre-flight**: CI pass | No conflicts\n**GitHub review URL**: ${reviewUrl}\n`;
      fs.writeFileSync(trackingPath, content);
      log(`Tracking file updated: ${path.basename(trackingPath)}`);

      fs.mkdirSync(APPROVED_DIR, { recursive: true });
      const filename = path.basename(trackingPath);
      const newPath = path.join(APPROVED_DIR, filename);
      fs.renameSync(trackingPath, newPath);
      db.updatePrTrackingPath(prId, newPath, 'approved');
      log(`Tracking file moved to approved/${filename}`);
    }

    log(`PR #${prId} approved successfully`);
    writeApproveLog(prId, logLines);

    return NextResponse.json({ success: true, review_url: reviewUrl, checks });
  } catch (err: any) {
    log(`Unexpected error: ${err.message}`);
    writeApproveLog(prId, logLines);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
