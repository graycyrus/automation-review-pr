import { NextResponse } from 'next/server';
import { db, sync, triggerJobs, tmux } from '@/lib/server-deps';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  const pr = db.getPrByIdFull(id);
  if (!pr) return NextResponse.json({ error: 'PR not found' }, { status: 404 });

  const cycles = db.getCyclesByPr(id);
  const liveStatus = sync.getLiveStatus();
  const job = triggerJobs.activeJobs.get(`review-${id}`);
  const statusRunning = liveStatus && liveStatus.running && liveStatus.pr === id;
  const tmuxRunning = tmux.isRunning(id);
  const tmuxWindow = tmux.hasWindow(id) ? `${tmux.SESSION}:pr-${id}` : null;
  const tmuxExit = tmuxWindow ? tmux.exitCode(id) : null;
  const fixRunning = tmux.isFixRunning(id);
  const fixMapping = tmux.getFixMapping(id);
  const fixWindow = fixMapping
    ? `${tmux.SESSION}:${fixMapping.window}`
    : tmux.listWindows().includes(`fix-${id}`)
    ? `${tmux.SESSION}:fix-${id}`
    : null;
  const isRunning = job ? !job.done : tmuxRunning || statusRunning;

  return NextResponse.json({
    ...pr,
    cycles,
    is_running: isRunning,
    is_fixing: fixRunning,
    tmux_window: tmuxWindow,
    tmux_exit_code: tmuxExit,
    tmux_fix_window: fixWindow,
  });
}
