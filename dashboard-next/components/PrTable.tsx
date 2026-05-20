'use client';
import Link from 'next/link';
import { Badge, statusTone } from './Badge';
import { ExtLink } from './ExtLink';
import { clsx } from '@/lib/clsx';
import { gh } from '@/lib/api';
import { useWhoamiStore } from '@/store/useWhoamiStore';
import type { Pr } from '@/lib/types';

function ciBadge(pr: Pr) {
  if (!pr.ci_total) return <span className="text-[var(--color-text-muted)] text-xs">-</span>;
  if ((pr.ci_fail ?? 0) > 0) return <Badge tone="red">{pr.ci_fail}/{pr.ci_total} fail</Badge>;
  if ((pr.ci_pending ?? 0) > 0) return <Badge tone="yellow">{pr.ci_pending}/{pr.ci_total} pending</Badge>;
  return <Badge tone="green">{pr.ci_pass}/{pr.ci_total} pass</Badge>;
}

// Render assignees as compact chips, highlighting "us" (the gh CLI user) so
// it's obvious at a glance which PRs we've already picked up.
function AssigneeChips({ assignees, me }: { assignees?: string; me: string | null }) {
  const list = (assignees || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (list.length === 0) return <span className="text-[var(--color-text-muted)] text-xs">—</span>;
  const meLower = me?.toLowerCase() ?? null;
  return (
    <span className="flex flex-wrap gap-1">
      {list.map((name) =>
        meLower && name.toLowerCase() === meLower ? (
          <Badge key={name} tone="blue" title={`Assigned to ${name} (you)`}>you</Badge>
        ) : (
          <Badge key={name} tone="gray" title={`Assigned to ${name}`}>{name}</Badge>
        ),
      )}
    </span>
  );
}

function findingsBadge(pr: Pr) {
  const total = (pr.findings_critical ?? 0) + (pr.findings_major ?? 0) + (pr.findings_minor ?? 0);
  if (total === 0) return <span className="text-[var(--color-text-muted)]">-</span>;
  return (
    <span className="flex gap-1">
      {pr.findings_critical ? <Badge tone="red">{pr.findings_critical} crit</Badge> : null}
      {pr.findings_major ? <Badge tone="yellow">{pr.findings_major} maj</Badge> : null}
      {pr.findings_minor ? <Badge tone="gray">{pr.findings_minor} min</Badge> : null}
    </span>
  );
}

export function PrTable({ prs }: { prs: Pr[] }) {
  const me = useWhoamiStore((s) => s.login);
  if (prs.length === 0) {
    return <div className="rounded border border-[var(--color-border)] p-8 text-center text-[var(--color-text-muted)]">No PRs match the current filters.</div>;
  }
  return (
    <div className="rounded border border-[var(--color-border)] overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-[var(--color-bg-secondary)] text-left text-[var(--color-text-muted)]">
          <tr>
            <th className="px-3 py-2 font-medium">PR</th>
            <th className="px-3 py-2 font-medium">Title</th>
            <th className="px-3 py-2 font-medium">Author</th>
            <th className="px-3 py-2 font-medium">Assigned</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">CI</th>
            <th className="px-3 py-2 font-medium">Findings</th>
            <th className="px-3 py-2 font-medium">Cycles</th>
            <th className="px-3 py-2 font-medium">Diff</th>
            <th className="px-3 py-2 font-medium text-right">Open</th>
          </tr>
        </thead>
        <tbody>
          {prs.map((pr) => (
            <tr
              key={pr.id}
              className={clsx(
                'border-t border-[var(--color-border)] hover:bg-[var(--color-bg-secondary)]',
                pr.is_running && 'bg-yellow-500/5',
                pr.mergeable === 'CONFLICTING' && 'bg-red-500/5',
              )}
            >
              <td className="px-3 py-2">
                <Link
                  href={`/pr/${pr.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--color-accent)] hover:underline font-medium"
                >
                  #{pr.id}
                </Link>
              </td>
              <td className="px-3 py-2 max-w-md truncate">
                <Link href={`/pr/${pr.id}`} target="_blank" rel="noopener noreferrer" className="hover:underline">
                  {pr.title || '(untitled)'}
                </Link>
                {pr.gh_is_draft ? <Badge tone="purple" className="ml-2">draft</Badge> : null}
                {pr.mergeable === 'CONFLICTING' ? <Badge tone="red" className="ml-2">conflict</Badge> : null}
                {pr.is_running ? <Badge tone="yellow" className="ml-2">reviewing…</Badge> : null}
              </td>
              <td className="px-3 py-2 text-[var(--color-text-muted)]">{pr.author || '-'}</td>
              <td className="px-3 py-2"><AssigneeChips assignees={pr.assignees} me={me} /></td>
              <td className="px-3 py-2"><Badge tone={statusTone(pr.status)}>{pr.status || '-'}</Badge></td>
              <td className="px-3 py-2">{ciBadge(pr)}</td>
              <td className="px-3 py-2">{findingsBadge(pr)}</td>
              <td className="px-3 py-2 text-[var(--color-text-muted)]">{pr.latest_cycle ?? 0}</td>
              <td className="px-3 py-2 text-[var(--color-text-muted)]">
                <span className="text-[var(--color-green)]">+{pr.additions ?? 0}</span>{' '}
                <span className="text-[var(--color-red)]">-{pr.deletions ?? 0}</span>
              </td>
              <td className="px-3 py-2 text-right whitespace-nowrap">
                <ExtLink
                  href={gh.prUrl(pr.id)}
                  className="rounded border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-border)] px-2 py-1 text-xs no-underline"
                  title="Open PR on GitHub"
                >
                  PR ↗
                </ExtLink>{' '}
                <ExtLink
                  href={gh.diffUrl(pr.id)}
                  className="rounded border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-border)] px-2 py-1 text-xs no-underline"
                  title="Open files diff on GitHub"
                >
                  Diff ↗
                </ExtLink>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
