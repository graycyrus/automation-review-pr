import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { db, triggerJobs } from '@/lib/server-deps';

export const dynamic = 'force-dynamic';

const REPO = 'tinyhumansai/openhuman';
const TO_BE_APPROVED_DIR = path.join(triggerJobs.BASE_DIR, 'to-be-approved');

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const prId = parseInt(idStr, 10);

  try {
    const pr = db.getPrById(prId);
    if (!pr) return NextResponse.json({ error: 'PR not found' }, { status: 404 });
    if (pr.status !== 'approved') {
      return NextResponse.json({ error: `PR #${prId} is not approved (current: ${pr.status})` }, { status: 400 });
    }

    try {
      const reviews = execSync(
        `gh api repos/${REPO}/pulls/${prId}/reviews --jq '[.[] | select(.user.login == "graycyrus" and .state == "APPROVED")] | last | .id'`,
        { encoding: 'utf-8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] }
      ).trim();
      if (reviews) {
        execSync(
          `gh api repos/${REPO}/pulls/${prId}/reviews/${reviews}/dismissals -X PUT -f message="Approval withdrawn" -f event=DISMISS`,
          { encoding: 'utf-8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] }
        );
        console.log(`[trigger] Dismissed APPROVE review ${reviews} on PR #${prId}`);
      }
    } catch (err: any) {
      console.warn(`[trigger] Could not dismiss review on PR #${prId}: ${err.message}`);
    }

    db.updatePrStatus(prId, 'clean');

    const trackingPath = pr.tracking_file_path;
    if (trackingPath && fs.existsSync(trackingPath)) {
      let content = fs.readFileSync(trackingPath, 'utf-8');
      content = content.replace(/\*\*Status\*\*:\s*approved/, '**Status**: clean');
      fs.writeFileSync(trackingPath, content);

      fs.mkdirSync(TO_BE_APPROVED_DIR, { recursive: true });
      const filename = path.basename(trackingPath);
      const newPath = path.join(TO_BE_APPROVED_DIR, filename);
      fs.renameSync(trackingPath, newPath);
      db.updatePrTrackingPath(prId, newPath, 'to-be-approved');
    }

    console.log(`[trigger] PR #${prId} unapproved — moved back to to-be-approved/`);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
