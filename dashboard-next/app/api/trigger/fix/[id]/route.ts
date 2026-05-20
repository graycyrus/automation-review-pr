import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { triggerJobs, tmux } from '@/lib/server-deps';
import { assignReviewer } from '@/lib/github-assign';

export const dynamic = 'force-dynamic';

// POST /api/trigger/fix/[id]
// Body: { pane_id?: string } — optional explicit target pane. If absent,
// the helper auto-picks the first idle openhuman-* pane.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const prId = parseInt(idStr, 10);

  if (!tmux.isAvailable()) {
    return NextResponse.json({ error: 'tmux not installed on the server' }, { status: 500 });
  }
  if (tmux.isFixRunning(prId)) {
    return NextResponse.json({ error: `Fix for PR #${prId} is already running` }, { status: 409 });
  }

  let paneId: string | undefined;
  try {
    const body = await req.json().catch(() => ({}));
    if (body && typeof body.pane_id === 'string') paneId = body.pane_id;
  } catch {}

  const logFile = path.join(triggerJobs.LOGS_DIR, `fix-PR-${prId}-tmux-${triggerJobs.timestamp()}.log`);

  try {
    const info = paneId
      ? tmux.startFixInSpecificPane(prId, logFile, paneId)
      : tmux.startFixInPane(prId, logFile);
    const assign = assignReviewer(prId);
    return NextResponse.json({
      pr: prId,
      session: info.session,
      window: info.window,
      pane_id: info.pane_id,
      workspace: info.workspace,
      attach: info.attach,
      logFile: info.logFile,
      assigned: assign.assigned,
      assign_error: assign.error ?? null,
      message: `Fix for PR #${prId} sent to ${info.workspace} (${info.session}:${info.window})`,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

// GET /api/trigger/fix/[id]
// Returns mapping + captured pane content + running state. The detail page
// polls this to mirror the tmux terminal live.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const prId = parseInt(idStr, 10);

  const mapping = tmux.getFixMapping(prId);
  if (!mapping) {
    return NextResponse.json({ running: false, mapping: null, content: null });
  }
  const lines = parseInt(req.nextUrl.searchParams.get('lines') || '400', 10);
  const content = tmux.capturePane(mapping.pane_id, { lines });
  return NextResponse.json({
    running: tmux.isFixRunning(prId),
    mapping,
    content,
  });
}
