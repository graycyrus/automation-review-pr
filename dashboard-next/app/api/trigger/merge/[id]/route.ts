import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { db, githubSync, triggerJobs } from '@/lib/server-deps';

export const dynamic = 'force-dynamic';

const REPO = 'tinyhumansai/openhuman';

// Single-quote escape for shell. 'foo' → 'foo'; 'it\'s' → 'it'\''s'.
const sh = (s: string) => `'${String(s).replace(/'/g, `'\\''`)}'`;

// Build the squash commit subject + body for a PR. Keeps co-author trailers
// for every distinct commit author on the PR and appends one for the gh
// user actually performing the merge ("our github creds") so the merger
// gets explicit credit in the trailer.
function buildSquashMessage(prId: number) {
  const view: any = JSON.parse(
    execSync(`gh pr view ${prId} --repo ${REPO} --json title,body,commits`, {
      encoding: 'utf-8',
      timeout: 15000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }),
  );

  const subject = view.title || `PR #${prId}`;
  const description = (view.body || '').trim();

  const coAuthors = new Map<string, string>();
  for (const commit of view.commits || []) {
    for (const a of commit.authors || []) {
      if (!a) continue;
      const name = a.name || a.login;
      // Prefer the noreply form if no real email is exposed.
      const email = a.email || (a.login ? `${a.login}@users.noreply.github.com` : null);
      if (!name || !email) continue;
      coAuthors.set(email.toLowerCase(), `Co-authored-by: ${name} <${email}>`);
    }
  }

  try {
    const me: any = JSON.parse(
      execSync(`gh api user`, { encoding: 'utf-8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] }),
    );
    const myName = me.name || me.login;
    const myEmail = `${me.id}+${me.login}@users.noreply.github.com`;
    coAuthors.set(myEmail.toLowerCase(), `Co-authored-by: ${myName} <${myEmail}>`);
  } catch {
    // gh api user can fail under rare auth states — co-author addition is
    // best-effort, the merge itself should still proceed.
  }

  const trailers = [...coAuthors.values()].join('\n');
  const body = [description, trailers].filter(Boolean).join('\n\n');
  return { subject, body };
}

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

  // Build the squash message ourselves so we can append a Co-authored-by
  // trailer for the gh user performing the merge.
  let messageFlags = '';
  try {
    const { subject, body } = buildSquashMessage(prId);
    messageFlags = `--subject ${sh(subject)} --body ${sh(body)}`;
  } catch (err: any) {
    console.warn(`[trigger] Could not build custom squash message for PR #${prId}: ${err.message}. Falling back to gh defaults.`);
  }

  try {
    const out = execSync(
      `gh pr merge ${prId} --repo ${REPO} ${flags.join(' ')} ${messageFlags}`.trim(),
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
