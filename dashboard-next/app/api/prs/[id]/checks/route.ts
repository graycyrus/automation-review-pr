import { NextResponse } from 'next/server';
import { db } from '@/lib/server-deps';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  const pr = db.getPrByIdFull(id);
  if (!pr) return NextResponse.json({ error: 'PR not found' }, { status: 404 });

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
  });
}
