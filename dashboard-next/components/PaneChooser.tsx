'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Button } from './Button';
import { Badge } from './Badge';

interface Pane {
  pane_id: string;
  window: string;
  command: string;
  cwd: string;
  workspace: string;
  idle: boolean;
}

// Modal-ish chooser. The user can pick an idle openhuman-* pane (or "Auto"
// to let the server auto-pick). The picked pane id is passed back to the
// caller to send the trigger.
export function PaneChooser({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (paneId: string | null) => Promise<void>;
}) {
  const [panes, setPanes] = useState<Pane[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPanes(null);
    setErr(null);
    api.listPanes().then((r) => setPanes(r.panes)).catch((e) => setErr(e.message));
  }, [open]);

  if (!open) return null;

  const handlePick = async (paneId: string | null) => {
    setSubmitting(paneId ?? '__auto__');
    try {
      await onPick(paneId);
      onClose();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <div className="fixed inset-0 z-40 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="rounded border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4 max-w-xl w-full max-h-[80vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">Pick a tmux pane for Fix</h3>
          <button onClick={onClose} className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]">×</button>
        </div>

        {err && <div className="rounded border border-red-500/30 bg-red-500/10 p-2 mb-3 text-xs text-[var(--color-red)]">{err}</div>}
        {!panes && !err && <div className="text-sm text-[var(--color-text-muted)]">Loading panes…</div>}

        {panes && (
          <>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => handlePick(null)}
                disabled={submitting !== null}
                className="text-left rounded border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 hover:bg-[var(--color-accent)]/15 px-3 py-2 disabled:opacity-50"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">Auto — first idle pane</span>
                  {submitting === '__auto__' && <span className="text-xs">sending…</span>}
                </div>
                <div className="text-xs text-[var(--color-text-muted)]">Server picks the first idle openhuman-* pane.</div>
              </button>

              {panes.length === 0 && (
                <div className="text-sm text-[var(--color-text-muted)] py-4">No openhuman-* panes in this tmux session.</div>
              )}

              {panes.map((p) => (
                <button
                  key={p.pane_id}
                  onClick={() => handlePick(p.pane_id)}
                  disabled={!p.idle || submitting !== null}
                  className="text-left rounded border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-border)] px-3 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <span className="text-sm font-medium">{p.workspace}</span>
                      <span className="ml-2 text-xs text-[var(--color-text-muted)]">{p.window} · {p.pane_id}</span>
                    </div>
                    {p.idle ? <Badge tone="green">idle ({p.command})</Badge> : <Badge tone="yellow">busy ({p.command})</Badge>}
                  </div>
                </button>
              ))}
            </div>
            <div className="mt-3 flex justify-end">
              <Button size="sm" onClick={onClose} disabled={submitting !== null}>Cancel</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
