import { NextResponse } from 'next/server';
import { execSync } from 'child_process';
import { db } from '@/lib/server-deps';

export const dynamic = 'force-dynamic';

const REPO = 'tinyhumansai/openhuman';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const prId = parseInt(idStr, 10);
  const pr = db.getPrByIdFull ? db.getPrByIdFull(prId) : db.getPrById(prId);
  if (!pr) return NextResponse.json({ error: 'PR not found' }, { status: 404 });

  const checks: Array<{ name: string; pass: boolean; bucket?: string }> = [];

  try {
    const out = execSync(`gh pr view ${prId} --repo ${REPO} --json isDraft --jq '.isDraft'`, { encoding: 'utf-8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    checks.push({ name: 'Not a draft', pass: out === 'false' });
  } catch { checks.push({ name: 'Not a draft', pass: false }); }

  try {
    const out = execSync(`gh pr view ${prId} --repo ${REPO} --json mergeable --jq '.mergeable'`, { encoding: 'utf-8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    checks.push({ name: 'No merge conflicts', pass: out === 'MERGEABLE' });
  } catch { checks.push({ name: 'No merge conflicts', pass: false }); }

  try {
    const out = execSync(`gh pr view ${prId} --repo ${REPO} --json reviewDecision --jq '.reviewDecision'`, { encoding: 'utf-8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    checks.push({ name: 'Has approval', pass: out === 'APPROVED' });
  } catch { checks.push({ name: 'Has approval', pass: false }); }

  try {
    const out = execSync(`gh pr checks ${prId} --repo ${REPO} --json name,bucket`, { encoding: 'utf-8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] });
    const ciChecks = JSON.parse(out);
    for (const c of ciChecks) {
      checks.push({ name: c.name, pass: c.bucket === 'pass' || c.bucket === 'skipping', bucket: c.bucket });
    }
  } catch {}

  const allPass = checks.every((c) => c.pass);
  const failCount = checks.filter((c) => !c.pass).length;

  return NextResponse.json({ pr: prId, checks, allPass, failCount });
}
