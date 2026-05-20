'use client';
import { useEffect, useState } from 'react';
import { gh } from '@/lib/api';
import { Section } from './Section';
import { Badge } from './Badge';
import { ExtLink } from './ExtLink';
import type { GhPr, GhFile, GhComment } from '@/lib/types';

// Lightweight Markdown — uses marked from CDN if present, falls back to <pre>.
function renderMd(src: string): string {
  if (typeof window !== 'undefined' && (window as any).marked) {
    return (window as any).marked.parse(src);
  }
  return `<pre style="white-space:pre-wrap">${src.replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]!))}</pre>`;
}

function useMarkedLoader() {
  const [ready, setReady] = useState<boolean>(() => typeof window !== 'undefined' && !!(window as any).marked);
  useEffect(() => {
    if (ready) return;
    if ((window as any).marked) { setReady(true); return; }
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/marked@15/marked.min.js';
    s.onload = () => setReady(true);
    document.head.appendChild(s);
  }, [ready]);
  return ready;
}

export function GithubDescription({ prId }: { prId: number }) {
  const [data, setData] = useState<GhPr | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const ready = useMarkedLoader();
  useEffect(() => { gh.pr(prId).then(setData).catch((e) => setErr(e.message)); }, [prId]);

  return (
    <Section
      title="Description"
      badge={<Badge tone={err ? 'red' : 'gray'}>{err ? 'Error' : data ? 'GitHub' : 'Loading…'}</Badge>}
    >
      {err && <p className="text-sm text-[var(--color-text-muted)]">{err}</p>}
      {!err && (!data || !data.body) && data !== null && (
        <p className="text-sm text-[var(--color-text-muted)]">No description.</p>
      )}
      {data?.body && ready && (
        <div className="md-content" dangerouslySetInnerHTML={{ __html: renderMd(data.body) }} />
      )}
    </Section>
  );
}

export function GithubFiles({ prId }: { prId: number }) {
  const [files, setFiles] = useState<GhFile[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { gh.files(prId).then(setFiles).catch((e) => setErr(e.message)); }, [prId]);

  const statusTone: Record<string, 'green' | 'red' | 'gray' | 'purple'> = {
    added: 'green', removed: 'red', modified: 'gray', renamed: 'purple',
  };

  return (
    <Section
      title="Files Changed"
      badge={
        <div className="flex items-center gap-2">
          <Badge tone={err ? 'red' : 'gray'}>
            {err ? 'Error' : files ? `${files.length} file${files.length === 1 ? '' : 's'}` : 'Loading…'}
          </Badge>
          <ExtLink href={gh.diffUrl(prId)} className="text-xs">View diff on GitHub →</ExtLink>
        </div>
      }
    >
      {err && <p className="text-sm text-[var(--color-text-muted)]">{err}</p>}
      {files && files.length === 0 && <p className="text-sm text-[var(--color-text-muted)]">No files.</p>}
      {files && files.length > 0 && (
        <table className="w-full text-sm">
          <thead className="text-left text-[var(--color-text-muted)]">
            <tr>
              <th className="py-1 font-medium">File</th>
              <th className="py-1 font-medium">Status</th>
              <th className="py-1 font-medium">+</th>
              <th className="py-1 font-medium">-</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {files.map((f) => (
              <tr key={f.filename} className="border-t border-[var(--color-border)]">
                <td className="py-1.5"><code className="text-xs">{f.filename}</code></td>
                <td className="py-1.5"><Badge tone={statusTone[f.status] ?? 'gray'}>{f.status}</Badge></td>
                <td className="py-1.5 text-[var(--color-green)]">+{f.additions}</td>
                <td className="py-1.5 text-[var(--color-red)]">-{f.deletions}</td>
                <td className="py-1.5">{f.blob_url && <ExtLink href={f.blob_url} className="text-xs">View</ExtLink>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}

export function GithubComments({ prId }: { prId: number }) {
  const [comments, setComments] = useState<GhComment[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const ready = useMarkedLoader();
  useEffect(() => { gh.comments(prId).then(setComments).catch((e) => setErr(e.message)); }, [prId]);

  return (
    <Section
      title="Comments"
      badge={
        <Badge tone={err ? 'red' : 'gray'}>
          {err ? 'Error' : comments ? `${comments.length} comment${comments.length === 1 ? '' : 's'}` : 'Loading…'}
        </Badge>
      }
    >
      {err && <p className="text-sm text-[var(--color-text-muted)]">{err}</p>}
      {comments && comments.length === 0 && <p className="text-sm text-[var(--color-text-muted)]">No comments.</p>}
      {comments && comments.length > 0 && (
        <div className="flex flex-col gap-3">
          {comments.map((c) => (
            <details key={`${c.kind}-${c.id}`} open className="rounded border border-[var(--color-border)] bg-[var(--color-bg-tertiary)]">
              <summary className="cursor-pointer px-3 py-2 flex items-center gap-2 text-sm">
                <strong>{c.user?.login ?? 'unknown'}</strong>
                <span className="text-[var(--color-text-muted)] text-xs">{new Date(c.created_at).toLocaleString()}</span>
                {c.kind === 'review' && c.path && (
                  <code className="text-xs text-[var(--color-text-muted)]">
                    {c.path}{c.line ? `:${c.line}` : ''}
                  </code>
                )}
                <span className="ml-auto"><ExtLink href={c.html_url} className="text-xs">Open</ExtLink></span>
              </summary>
              {ready && (
                <div
                  className="md-content border-t border-[var(--color-border)] px-3 py-2"
                  dangerouslySetInnerHTML={{ __html: renderMd(c.body || '') }}
                />
              )}
            </details>
          ))}
        </div>
      )}
    </Section>
  );
}
