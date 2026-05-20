import { NextResponse } from 'next/server';
import { tmux } from '@/lib/server-deps';

export const dynamic = 'force-dynamic';

// List of openhuman-* panes plus their idle/busy state. The UI uses this to
// let the user pick which pane to send a fix into.
export async function GET() {
  if (!tmux.isAvailable() || !tmux.sessionExists()) {
    return NextResponse.json({ session: null, panes: [] });
  }

  // Panes already running an in-flight fix shouldn't appear as idle even
  // when their tmux pane_current_command is still a shell — pnpm/claude
  // hasn't started yet but the keystrokes are already queued.
  const reserved: Set<string> = tmux.reservedPaneIds();

  const panes = tmux.listPanes()
    .filter((p: any) => /\/openhuman-\d+(?:\/|$)/.test(p.cwd || ''))
    .map((p: any) => {
      const shellIdle = ['bash', 'zsh', 'sh', 'fish'].includes(p.command);
      const isReserved = reserved.has(p.pane_id);
      return {
        pane_id: p.pane_id,
        window: p.window,
        command: isReserved ? `${p.command} (fix queued)` : p.command,
        cwd: p.cwd,
        workspace: p.cwd?.match(/\/openhuman-\d+/)?.[0]?.slice(1) ?? p.cwd,
        idle: shellIdle && !isReserved,
        reserved: isReserved,
      };
    })
    .sort((a: any, b: any) => {
      // idle first, then by workspace number
      if (a.idle !== b.idle) return a.idle ? -1 : 1;
      const an = parseInt(a.workspace.match(/\d+/)?.[0] ?? '0', 10);
      const bn = parseInt(b.workspace.match(/\d+/)?.[0] ?? '0', 10);
      return an - bn;
    });

  return NextResponse.json({ session: tmux.SESSION, panes });
}
