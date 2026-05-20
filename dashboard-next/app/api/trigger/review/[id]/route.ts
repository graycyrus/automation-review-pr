import { NextResponse } from 'next/server';
import path from 'path';
import { triggerJobs, tmux } from '@/lib/server-deps';
import { assignReviewer } from '@/lib/github-assign';

export const dynamic = 'force-dynamic';

// Reviews now run inside a tmux window of the long-lived `super-review`
// session. The user can attach with `tmux attach -t super-review` to watch
// or intervene. Completion is detected via the exit-code sentinel file
// written by tmux.js.

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const prId = parseInt(idStr, 10);

  if (!tmux.isAvailable()) {
    return NextResponse.json({ error: 'tmux not installed on the server' }, { status: 500 });
  }

  if (tmux.isRunning(prId)) {
    return NextResponse.json({ error: `Review for PR #${prId} is already running` }, { status: 409 });
  }

  const logFile = path.join(triggerJobs.LOGS_DIR, `review-PR-${prId}-tmux-${triggerJobs.timestamp()}.log`);

  try {
    const info = tmux.startReview(prId, logFile);
    const assign = assignReviewer(prId);
    return NextResponse.json({
      pr: prId,
      session: info.session,
      window: info.window,
      attach: info.attach,
      logFile: info.logFile,
      assigned: assign.assigned,
      assign_error: assign.error ?? null,
      message: `Review for PR #${prId} started in ${info.session}:${info.window}`,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
