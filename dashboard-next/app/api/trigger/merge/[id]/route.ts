import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { db, githubSync, triggerJobs } from '@/lib/server-deps';

export const dynamic = 'force-dynamic';

const REPO = 'tinyhumansai/openhuman';

// POST /api/trigger/merge/[id]
// Body: { force?: boolean }
//   force=true skips the local eligibility check and passes --admin to
//   `gh pr merge`, bypassing branch protection / failing required checks
//   when the caller has admin rights. We always squash + delete-branch.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const prId = parseInt(idStr, 10);

  let body: { force?: boolean } = {};
  try { body = await req.json(); } catch {}
  const force = body.force === true;

  const pr = db.getPrByIdFull ? db.getPrByIdFull(prId) : db.getPrById(prId);
  if (!pr) return NextResponse.json({ error: 'PR not found' }, { status: 404 });

  if (!force) {
    const eligible = pr.status === 'approved' || pr.status === 'clean' || pr.review_decision === 'APPROVED';
    if (!eligible) {
      return NextResponse.json(
        { error: `PR #${prId} is not eligible for merge (status: ${pr.status}). Use force merge to override.` },
        { status: 400 },
      );
    }
  }

  const flags = ['--squash', '--delete-branch'];
  if (force) flags.push('--admin');

  try {
    const out = execSync(
      `gh pr merge ${prId} --repo ${REPO} ${flags.join(' ')}`,
      { encoding: 'utf-8', timeout: 60000, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    console.log(`[trigger] PR #${prId} merged${force ? ' (force/admin)' : ''} successfully`);

    githubSync.handlePrMerged(prId);

    fs.mkdirSync(triggerJobs.LOGS_DIR, { recursive: true });
    const logFile = path.join(triggerJobs.LOGS_DIR, `merge-PR-${prId}-${triggerJobs.timestamp()}.log`);
    fs.writeFileSync(
      logFile,
      `[${new Date().toISOString()}] PR #${prId} merged via squash${force ? ' --admin' : ''}\n${out || ''}\n`,
    );

    return NextResponse.json({ success: true, force, message: `PR #${prId} merged${force ? ' (force)' : ''}` });
  } catch (err: any) {
    console.error(`[trigger] Merge of PR #${prId} failed: ${err.message}`);
    return NextResponse.json({ error: `Merge failed: ${err.stderr || err.message}` }, { status: 500 });
  }
}
