'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Section } from './Section';
import { Badge } from './Badge';

export function TrackingFile({ prId }: { prId: number }) {
  const [html, setHtml] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    api.prTrackingHtml(prId).then((h) => { setHtml(h); setLoaded(true); });
  }, [prId]);

  return (
    <Section title="Tracking File" badge={<Badge tone={html ? 'gray' : loaded ? 'red' : 'gray'}>{html ? 'rendered' : loaded ? 'missing' : 'Loading…'}</Badge>}>
      {loaded && !html && <p className="text-sm text-[var(--color-text-muted)]">No tracking file yet.</p>}
      {html && <div className="md-content" dangerouslySetInnerHTML={{ __html: html }} />}
    </Section>
  );
}
