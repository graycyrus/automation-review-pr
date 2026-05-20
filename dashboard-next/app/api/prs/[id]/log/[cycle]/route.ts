import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { db } from '@/lib/server-deps';

export const dynamic = 'force-dynamic';

const LOGS_DIR = path.resolve(process.cwd(), '..', 'logs');

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; cycle: string }> }) {
  const { id: idStr, cycle: cycleStr } = await params;
  const id = parseInt(idStr, 10);
  const cycleNum = parseInt(cycleStr, 10);

  const cycles = db.getCyclesByPr(id);
  const cycle = cycles.find((c: any) => c.cycle_number === cycleNum);

  const send = (content: string) =>
    new NextResponse(content, { headers: { 'content-type': 'text/plain; charset=utf-8' } });

  if (!cycle || !cycle.log_file_path || !fs.existsSync(cycle.log_file_path)) {
    const logPattern = new RegExp(`review-PR-${id}.*\\.log$`);
    const logFiles = fs.existsSync(LOGS_DIR)
      ? fs.readdirSync(LOGS_DIR).filter((f) => logPattern.test(f)).sort()
      : [];
    if (logFiles.length > 0 && logFiles[cycleNum - 1]) {
      return send(fs.readFileSync(path.join(LOGS_DIR, logFiles[cycleNum - 1]), 'utf-8'));
    }
    return NextResponse.json({ error: 'Log not found' }, { status: 404 });
  }

  return send(fs.readFileSync(cycle.log_file_path, 'utf-8'));
}
