import type { ReactNode } from 'react';

export function Section({
  title,
  badge,
  children,
}: {
  title: string;
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded border border-[var(--color-border)] bg-[var(--color-bg-secondary)] mb-4">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {badge}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}
