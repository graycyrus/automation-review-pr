'use client';
import type { Stats } from '@/lib/types';

const cards: Array<{ key: keyof Stats; label: string }> = [
  { key: 'total', label: 'Total' },
  { key: 'under_review', label: 'Under Review' },
  { key: 'changes_requested', label: 'Changes Req.' },
  { key: 'clean', label: 'Clean' },
  { key: 'blocked', label: 'Blocked' },
  { key: 'pending', label: 'Pending' },
  { key: 'drafts', label: 'Drafts' },
];

export function StatsBar({ stats }: { stats: Stats | null }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 mb-4">
      {cards.map(({ key, label }) => (
        <div key={key} className="rounded border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2">
          <div className="text-xs text-[var(--color-text-muted)]">{label}</div>
          <div className="text-xl font-semibold mt-0.5">{stats?.[key] ?? '-'}</div>
        </div>
      ))}
    </div>
  );
}
