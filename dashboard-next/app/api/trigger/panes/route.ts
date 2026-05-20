import { NextResponse } from 'next/server';
import { tmux } from '@/lib/server-deps';

export const dynamic = 'force-dynamic';

// List of openhuman-* panes plus their idle/busy state. The UI uses this to
// let the user pick which pane to send a fix into.
export async function GET() {
  if (!tmux.isAvailable() || !tmux.sessionExists()) {
    return NextResponse.json({ session: null, panes: [] });
  }

  const panes = tmux.listPanes()
    .filter((p: any) => /\/openhuman-\d+(?:\/|$)/.test(p.cwd || ''))
    .map((p: any) => ({
      pane_id: p.pane_id,
      window: p.window,
      command: p.command,
      cwd: p.cwd,
      workspace: p.cwd?.match(/\/openhuman-\d+/)?.[0]?.slice(1) ?? p.cwd,
      idle: ['bash', 'zsh', 'sh', 'fish'].includes(p.command),
    }))
    .sort((a: any, b: any) => {
      // idle first, then by workspace number
      if (a.idle !== b.idle) return a.idle ? -1 : 1;
      const an = parseInt(a.workspace.match(/\d+/)?.[0] ?? '0', 10);
      const bn = parseInt(b.workspace.match(/\d+/)?.[0] ?? '0', 10);
      return an - bn;
    });

  return NextResponse.json({ session: tmux.SESSION, panes });
}
