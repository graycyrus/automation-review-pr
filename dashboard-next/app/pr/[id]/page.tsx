'use client';
import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import type { Pr } from '@/lib/types';
import { PrHeader } from '@/components/PrHeader';
import { PrActions } from '@/components/PrActions';
import { GithubDescription, GithubFiles, GithubComments } from '@/components/GithubSections';
import { ChecksTable } from '@/components/ChecksTable';
import { CyclesTimeline } from '@/components/CyclesTimeline';
import { TrackingFile } from '@/components/TrackingFile';
import { Section } from '@/components/Section';
import { FixTerminal } from '@/components/FixTerminal';

export default function PrDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const prId = parseInt(id, 10);
  const [pr, setPr] = useState<Pr | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.pr(prId);
      setPr(data);
    } catch (e: any) {
      setError(e.message);
    }
  }, [prId]);

  useEffect(() => { load(); }, [load]);

  // Light polling while a review is running
  useEffect(() => {
    if (!pr?.is_running) return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [pr?.is_running, load]);

  return (
    <>
      <Link
        href="/"
        className="inline-block mb-3 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
      >
        ← Back to Dashboard
      </Link>

      {error && (
        <div className="rounded border border-red-500/30 bg-red-500/10 p-3 mb-3 text-sm text-[var(--color-red)]">{error}</div>
      )}

      {!pr && !error && <div className="text-[var(--color-text-muted)]">Loading PR #{prId}…</div>}

      {pr && (
        <>
          <PrHeader pr={pr} />

          <Section title="Actions">
            <PrActions pr={pr} onAction={load} />
          </Section>

          <FixTerminal prId={prId} />

          <GithubDescription prId={prId} />
          <ChecksTable prId={prId} />
          <CyclesTimeline cycles={pr.cycles ?? []} />
          <TrackingFile prId={prId} />
          <GithubFiles prId={prId} />
          <GithubComments prId={prId} />
        </>
      )}
    </>
  );
}
