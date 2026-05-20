import { NextResponse } from 'next/server';
import fs from 'fs';
import { marked } from 'marked';
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

  const html = await marked(fs.readFileSync(filePath, 'utf-8'));
  return new NextResponse(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
