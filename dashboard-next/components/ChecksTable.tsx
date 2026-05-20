'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Badge } from './Badge';
import { Section } from './Section';
import { ExtLink } from './ExtLink';
import type { CiCheck } from '@/lib/types';

const bucketTone: Record<string, 'green' | 'red' | 'yellow' | 'gray'> = {
  pass: 'green', fail: 'red', pending: 'yellow', queued: 'yellow', skipping: 'gray', cancel: 'gray',
};
const bucketOrder: Record<string, number> = { fail: 0, pending: 1, queued: 1, skipping: 2, cancel: 2, pass: 3 };

export function ChecksTable({ prId }: { prId: number }) {
  const [data, setData] = useState<{ checks: CiCheck[]; total: number; pass: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.prChecks(prId).then(setData).catch((e) => setErr(e.message)); }, [prId]);

  const badge = err
    ? <Badge tone="red">Error</Badge>
    : data ? <Badge tone="gray">{data.pass}/{data.total} passing</Badge> : <Badge tone="gray">Loading…</Badge>;

  const sorted = data?.checks ? [...data.checks].sort((a, b) => (bucketOrder[a.bucket] ?? 9) - (bucketOrder[b.bucket] ?? 9)) : [];

  return (
    <Section title="Checks" badge={badge}>
      {err && <p className="text-sm text-[var(--color-text-muted)]">{err}</p>}
      {data && sorted.length === 0 && <p className="text-sm text-[var(--color-text-muted)]">No CI checks.</p>}
      {sorted.length > 0 && (
        <table className="w-full text-sm">
          <thead className="text-left text-[var(--color-text-muted)]">
            <tr>
              <th className="py-1 font-medium">Check</th>
              <th className="py-1 font-medium">Status</th>
              <th className="py-1 font-medium">Workflow</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((c) => (
              <tr key={`${c.workflow}-${c.name}`} className="border-t border-[var(--color-border)]">
                <td className="py-1.5">{c.name}</td>
                <td className="py-1.5"><Badge tone={bucketTone[c.bucket] ?? 'gray'}>{c.bucket}</Badge></td>
                <td className="py-1.5 text-[var(--color-text-muted)]">{c.workflow || '-'}</td>
                <td className="py-1.5">{c.link && <ExtLink href={c.link} className="text-xs">Details</ExtLink>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}
