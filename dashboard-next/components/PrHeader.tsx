import { Badge, statusTone } from './Badge';
import { ExtLink } from './ExtLink';
import { gh } from '@/lib/api';
import type { Pr } from '@/lib/types';

export function PrHeader({ pr }: { pr: Pr }) {
  const isDraft = pr.gh_is_draft || pr.is_draft;

  return (
    <div className="rounded border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4 mb-4">
      <div className="flex items-start gap-3">
        <h2 className="text-xl font-semibold flex-1">
          #{pr.id} {pr.title || '(untitled)'}
          {isDraft ? <Badge tone="purple" className="ml-2">draft</Badge> : null}
        </h2>
      </div>

      <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-sm text-[var(--color-text-muted)]">
        <div><strong className="text-[var(--color-text)]">Author:</strong> {pr.author || '-'}{pr.is_member ? <Badge tone="blue" className="ml-2">member</Badge> : null}</div>
        <div><strong className="text-[var(--color-text)]">Branch:</strong> <code>{pr.branch}</code> → <code>{pr.base_branch || 'main'}</code></div>
        <div><strong className="text-[var(--color-text)]">Created:</strong> {pr.created_at || '-'}</div>
        <div><strong className="text-[var(--color-text)]">Updated:</strong> {pr.updated_at_gh || '-'}</div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Badge tone={statusTone(pr.status)}>{pr.status || '-'}</Badge>
        {pr.mergeable && <Badge tone={pr.mergeable === 'MERGEABLE' ? 'green' : pr.mergeable === 'CONFLICTING' ? 'red' : 'gray'}>{pr.mergeable}</Badge>}
        {pr.review_decision && <Badge tone={pr.review_decision === 'APPROVED' ? 'green' : pr.review_decision === 'CHANGES_REQUESTED' ? 'red' : 'gray'}>{pr.review_decision}</Badge>}
        <span className="text-sm text-[var(--color-text-muted)]">
          <span className="text-[var(--color-green)]">+{pr.additions ?? 0}</span>{' '}
          <span className="text-[var(--color-red)]">-{pr.deletions ?? 0}</span>{' '}
          across {pr.changed_files ?? 0} file{pr.changed_files === 1 ? '' : 's'}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <ExtLink href={gh.prUrl(pr.id)} className="rounded border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-border)] px-3 py-1.5 text-sm no-underline">
          View on GitHub
        </ExtLink>
        <ExtLink href={gh.diffUrl(pr.id)} className="rounded border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-border)] px-3 py-1.5 text-sm no-underline">
          View Files Diff →
        </ExtLink>
      </div>
    </div>
  );
}
