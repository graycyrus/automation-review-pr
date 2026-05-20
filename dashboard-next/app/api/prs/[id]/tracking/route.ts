import { NextResponse } from 'next/server';
import fs from 'fs';
import { db } from '@/lib/server-deps';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  const pr = db.getPrById(id);
  if (!pr) return NextResponse.json({ error: 'PR not found' }, { status: 404 });

  const filePath = pr.tracking_file_path;
  if (!filePath || !fs.existsSync(filePath)) {
    return NextResponse.json({ error: 'Tracking file not found' }, { status: 404 });
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  return new NextResponse(content, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
