import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { triggerJobs, tmux } from '@/lib/server-deps';

export const dynamic = 'force-dynamic';

const STATUS_FILE = path.join(triggerJobs.BASE_DIR, 'status.json');

export async function POST(_req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const job = triggerJobs.activeJobs.get(jobId);

  // Fix jobs share an existing openhuman-* pane — Ctrl-C the process rather
  // than killing the pane.
  const fixMatch = /^fix-(\d+)$/.exec(jobId);
  if (fixMatch) {
    const prId = parseInt(fixMatch[1], 10);
    tmux.killFix(prId);
    return NextResponse.json({ message: `Sent Ctrl-C to fix-${prId} pane`, jobId });
  }

  // Reviews now run in tmux, not via spawn-tracked jobs. If this is a review
  // cancel, kill the tmux window for that PR regardless of whether we have
  // an in-memory job record.
  const reviewMatch = /^review-(\d+)$/.exec(jobId);
  if (reviewMatch) {
    const prId = parseInt(reviewMatch[1], 10);
    if (tmux.hasWindow(prId)) {
      tmux.killWindow(prId);
      try {
        const status = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf-8'));
        if (status.pr === prId) fs.writeFileSync(STATUS_FILE, JSON.stringify({ running: false }));
      } catch {}
      if (!job) {
        return NextResponse.json({ message: `Killed tmux window pr-${prId}`, jobId });
      }
    }
  }

  if (!job) {
    try {
      const status = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf-8'));
      if (status.running) fs.writeFileSync(STATUS_FILE, JSON.stringify({ running: false }));
    } catch {}
    return NextResponse.json({ message: 'No active job — cleared stale state', jobId });
  }

  if (job.done) {
    return NextResponse.json({ message: 'Job already finished', jobId });
  }

  try {
    execSync(`pkill -TERM -P ${job.pid} 2>/dev/null; kill -TERM ${job.pid} 2>/dev/null`, {
      stdio: 'ignore',
      timeout: 5000,
    });
  } catch {}

  job.logLines.push('[cancelled] Review cancelled by user');
  job.done = true;
  job.exitCode = -1;
  job.endedAt = new Date().toISOString();

  try {
    const status = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf-8'));
    if (status.pr === job.pr) fs.writeFileSync(STATUS_FILE, JSON.stringify({ running: false }));
  } catch {}

  console.log(`[trigger] Job ${jobId} cancelled by user`);
  setTimeout(() => triggerJobs.activeJobs.delete(jobId), 60 * 1000);

  return NextResponse.json({ message: `Job ${jobId} cancelled`, jobId });
}
