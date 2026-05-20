import { Badge } from './Badge';
import { ExtLink } from './ExtLink';
import { Section } from './Section';
import type { ReviewCycle } from '@/lib/types';

function fmtDuration(s?: number) {
  if (!s || s < 0) return '-';
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

export function CyclesTimeline({ cycles }: { cycles: ReviewCycle[] }) {
  return (
    <Section title="Review Timeline" badge={<Badge tone="gray">{cycles.length} cycle{cycles.length === 1 ? '' : 's'}</Badge>}>
      {cycles.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">No reviews yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {cycles.map((c) => {
            const findings = (c.findings_critical ?? 0) + (c.findings_major ?? 0) + (c.findings_minor ?? 0);
            return (
              <div key={c.id} className="rounded border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] p-3">
                <div className="flex items-center gap-2 mb-2">
                  <strong>Cycle {c.cycle_number}</strong>
                  <Badge tone="gray">{c.type || 'Fresh'}</Badge>
                  {c.action_taken && <Badge tone="blue">{c.action_taken}</Badge>}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs text-[var(--color-text-muted)]">
                  <div><strong className="text-[var(--color-text)]">Started:</strong> {c.started_at || '-'}</div>
                  <div><strong className="text-[var(--color-text)]">Duration:</strong> {fmtDuration(c.duration_seconds)}</div>
                  <div><strong className="text-[var(--color-text)]">Commit:</strong> <code>{c.commit_sha?.slice(0, 7) || '-'}</code></div>
                  <div><strong className="text-[var(--color-text)]">Gates:</strong> {c.gates || '-'}</div>
                </div>
                {c.summary && (
                  <p className="mt-2 text-sm border-l-2 border-[var(--color-border)] pl-3">{c.summary}</p>
                )}
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  {(c.findings_critical ?? 0) > 0 && <Badge tone="red">{c.findings_critical} critical</Badge>}
                  {(c.findings_major ?? 0) > 0 && <Badge tone="yellow">{c.findings_major} major</Badge>}
                  {(c.findings_minor ?? 0) > 0 && <Badge tone="gray">{c.findings_minor} minor</Badge>}
                  {findings === 0 && <Badge tone="green">no findings</Badge>}
                  {c.github_review_url && <ExtLink href={c.github_review_url} className="text-xs ml-auto">View on GitHub →</ExtLink>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}
