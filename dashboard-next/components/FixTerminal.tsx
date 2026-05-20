'use client';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '@/lib/api';
import { Section } from './Section';
import { Badge } from './Badge';
import { Button } from './Button';

// Detect http(s) URLs in plain pane text and wrap them in <a target="_blank">.
// Common trailing punctuation (.,;:!?)] is peeled off so it doesn't end up
// inside the link — handles things like "see https://x.com/foo." cleanly.
const URL_RE = /(https?:\/\/[^\s<>"'`]+)/g;
const TRAILING_PUNCT = /[.,;:!?\)\]]+$/;

function linkify(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(text)) !== null) {
    let url = m[0];
    const trail = url.match(TRAILING_PUNCT);
    const trailStr = trail ? trail[0] : '';
    if (trailStr) url = url.slice(0, -trailStr.length);
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <a
        key={`${m.index}-${url}`}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[var(--color-accent)] underline decoration-dotted underline-offset-2 hover:decoration-solid break-all"
      >
        {url}
      </a>,
    );
    if (trailStr) out.push(trailStr);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

interface FixStatus {
  running: boolean;
  mapping: { pane_id: string; window: string; workspace: string; logFile: string; started_at: string } | null;
  content: string | null;
}

// Live terminal viewer that polls /api/trigger/fix/[id] every 2s, calls
// `tmux capture-pane` on the targeted pane, and renders the output in a
// monospaced panel with auto-scroll. Only visible once a fix has been
// triggered (i.e., a mapping file exists for this PR).
export function FixTerminal({ prId }: { prId: number }) {
  const [status, setStatus] = useState<FixStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);

  const send = async (payload: { text?: string; key?: string }) => {
    setSending(true);
    try {
      await api.fixSend(prId, payload);
      if (payload.text !== undefined) setInput('');
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSending(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const data = await api.fixStatus(prId);
        if (cancelled) return;
        setStatus(data);
        setError(null);
      } catch (e: any) {
        if (!cancelled) setError(e.message);
      }
    };
    tick();
    const interval = setInterval(tick, 2000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [prId]);

  // Always pin to the bottom on content change. requestAnimationFrame waits
  // for the new content to lay out before we compute scrollHeight, otherwise
  // we sometimes scroll to the old height and miss the latest line.
  useEffect(() => {
    const el = preRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [status?.content]);

  if (!status || !status.mapping) return null;

  const m = status.mapping;
  const attach = `tmux attach -t super-review \\; select-window -t ${m.window}`;

  return (
    <Section
      title="Fix Terminal"
      badge={
        <div className="flex items-center gap-2">
          <Badge tone={status.running ? 'yellow' : error ? 'red' : 'green'}>
            {status.running ? 'running' : error ? 'error' : 'done'}
          </Badge>
          <span className="text-xs text-[var(--color-text-muted)]">
            {m.workspace.split('/').pop()} · {m.window} · {m.pane_id}
          </span>
        </div>
      }
    >
      <div className="text-xs text-[var(--color-text-muted)] mb-2 flex items-center gap-3 flex-wrap">
        <span>Started {new Date(m.started_at).toLocaleTimeString()}</span>
        <button
          onClick={() => navigator.clipboard?.writeText(attach)}
          className="rounded border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-border)] px-2 py-0.5"
          title="Copy tmux attach command"
        >
          Copy attach cmd
        </button>
        <Button
          size="sm"
          variant="red"
          onClick={async () => {
            try { await api.cancelJob(`fix-${prId}`); } catch (e: any) { alert(e.message); }
          }}
          disabled={!status.running}
        >
          Cancel
        </Button>
      </div>
      <pre
        ref={preRef}
        className="bg-black/40 border border-[var(--color-border)] rounded p-3 text-xs leading-snug font-mono max-h-[480px] overflow-auto whitespace-pre-wrap break-words"
      >
        {status.content ? linkify(status.content) : '(empty)'}
      </pre>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!input.trim() && !input) return;
          send({ text: input });
        }}
        className="mt-3 flex flex-col gap-2"
      >
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a prompt for claude, then Enter to send…"
            disabled={sending}
            className="flex-1 rounded border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)] disabled:opacity-50"
          />
          <Button size="sm" variant="primary" disabled={sending || (!input && input !== '')}>
            {sending ? 'Sending…' : 'Send ↵'}
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5 text-xs text-[var(--color-text-muted)]">
          <span className="self-center mr-1">Keys:</span>
          {[
            { label: 'Enter', key: 'Enter' },
            { label: 'Esc', key: 'Escape' },
            { label: 'Ctrl-C', key: 'C-c' },
            { label: 'Ctrl-D', key: 'C-d' },
            { label: '↑', key: 'Up' },
            { label: '↓', key: 'Down' },
            { label: 'Tab', key: 'Tab' },
          ].map((k) => (
            <button
              key={k.key}
              type="button"
              onClick={() => send({ key: k.key })}
              disabled={sending}
              className="rounded border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-border)] px-2 py-0.5 disabled:opacity-50"
            >
              {k.label}
            </button>
          ))}
          {/* /exit is a claude slash-command, not a tmux key — type it as
              text and press Enter. Frees the pane so it shows up as idle
              again for the next fix. */}
          <button
            type="button"
            onClick={() => send({ text: '/exit' })}
            disabled={sending || !status.running}
            className="rounded border border-red-500/40 bg-red-500/15 text-[var(--color-red)] hover:bg-red-500/25 px-2 py-0.5 disabled:opacity-50"
            title="Send /exit to claude to free this pane"
          >
            /exit
          </button>
        </div>
      </form>
    </Section>
  );
}
