import { NextResponse } from 'next/server';
import fs from 'fs';
import { db, sync, githubSync } from '@/lib/server-deps';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  try {
    const existing = db.getPrById(id);
    if (existing && existing.tracking_file_path && fs.existsSync(existing.tracking_file_path)) {
      sync.syncFile(existing.tracking_file_path, existing.location);
    }
    const updated = githubSync.fetchSinglePr(id);
    const cycles = db.getCyclesByPr(id);
    return NextResponse.json({ ...updated, cycles, synced: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
