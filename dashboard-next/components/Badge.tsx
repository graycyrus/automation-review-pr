import type { ReactNode } from 'react';
import { clsx } from '@/lib/clsx';

type Tone = 'gray' | 'green' | 'red' | 'yellow' | 'purple' | 'blue';

const toneClass: Record<Tone, string> = {
  gray: 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-muted)] border-[var(--color-border)]',
  green: 'bg-green-500/15 text-[var(--color-green)] border-green-500/30',
  red: 'bg-red-500/15 text-[var(--color-red)] border-red-500/30',
  yellow: 'bg-yellow-500/15 text-[var(--color-yellow)] border-yellow-500/30',
  purple: 'bg-purple-500/15 text-[var(--color-purple)] border-purple-500/30',
  blue: 'bg-blue-500/15 text-[var(--color-accent)] border-blue-500/30',
};

export function Badge({ tone = 'gray', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[12px] font-medium leading-5',
        toneClass[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function statusTone(status: string | undefined): Tone {
  switch (status) {
    case 'clean':
    case 'approved':
      return 'green';
    case 'changes-requested':
    case 'blocked':
      return 'red';
    case 'pending':
    case 'under-review':
      return 'yellow';
    case 'merged':
    case 'closed':
      return 'purple';
    default:
      return 'gray';
  }
}
