import { NextRequest, NextResponse } from 'next/server';
import { tmux } from '@/lib/server-deps';

export const dynamic = 'force-dynamic';

// POST /api/trigger/fix/[id]/send
// Body:
//   { text: string }    — types the text into the pane + presses Enter
//   { key:  string }    — sends a tmux key name (Escape, C-c, Up, Down, …)
// At least one of `text` or `key` is required.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const prId = parseInt(idStr, 10);

  const mapping = tmux.getFixMapping(prId);
  if (!mapping) {
    return NextResponse.json({ error: 'No active fix mapping for this PR' }, { status: 404 });
  }

  let body: { text?: string; key?: string } = {};
  try { body = await req.json(); } catch {}
  if (!body.text && !body.key) {
    return NextResponse.json({ error: 'Provide either `text` or `key`' }, { status: 400 });
  }

  try {
    if (body.text !== undefined) tmux.sendToPane(mapping.pane_id, body.text);
    if (body.key) tmux.sendKey(mapping.pane_id, body.key);
    return NextResponse.json({ sent: true, pane_id: mapping.pane_id });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
