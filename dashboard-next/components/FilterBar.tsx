'use client';
import { useEffect } from 'react';
import { usePrStore } from '@/store/usePrStore';

export function FilterBar() {
  const { filters, filterOptions, setFilter, setFilters, resetFilters, loadFilterOptions } = usePrStore();

  useEffect(() => { loadFilterOptions(); }, [loadFilterOptions]);

  const input = 'rounded border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-2 py-1 text-sm text-[var(--color-text)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]';

  return (
    <div className="rounded border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3 mb-4 grid gap-3 grid-cols-2 sm:grid-cols-4 lg:grid-cols-6">
      <input
        className={input + ' col-span-2 lg:col-span-2'}
        placeholder="Search PR #, title, author, label…"
        value={filters.search ?? ''}
        onChange={(e) => setFilter('search', e.target.value)}
      />
      <select className={input} value={filters.status ?? ''} onChange={(e) => setFilter('status', e.target.value || undefined)}>
        <option value="">All statuses</option>
        {filterOptions?.statuses.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
      <select className={input} value={filters.author ?? ''} onChange={(e) => setFilter('author', e.target.value || undefined)}>
        <option value="">All authors</option>
        {filterOptions?.authors.map((a) => <option key={a} value={a}>{a}</option>)}
      </select>
      <select className={input} value={filters.member ?? ''} onChange={(e) => setFilter('member', e.target.value || undefined)}>
        <option value="">Members + collabs</option>
        <option value="1">Members only</option>
        <option value="0">Collaborators only</option>
      </select>
      <select className={input} value={filters.draft ?? ''} onChange={(e) => setFilter('draft', e.target.value || undefined)}>
        <option value="">All drafts</option>
        <option value="0">Not draft</option>
        <option value="1">Draft</option>
      </select>
      <select className={input} value={filters.ci_status ?? ''} onChange={(e) => setFilter('ci_status', e.target.value || undefined)}>
        <option value="">Any CI</option>
        <option value="pass">CI passing</option>
        <option value="fail">CI failing</option>
        <option value="pending">CI pending</option>
      </select>
      <select className={input} value={filters.has_findings ?? ''} onChange={(e) => setFilter('has_findings', e.target.value || undefined)}>
        <option value="">Any findings</option>
        <option value="1">Has findings</option>
        <option value="0">No findings</option>
      </select>
      <select className={input} value={filters.sort ?? ''} onChange={(e) => setFilters({ sort: e.target.value || undefined })}>
        <option value="">Sort: PR # (desc)</option>
        <option value="updated">Last updated</option>
        <option value="created">Created date</option>
        <option value="findings">Findings</option>
        <option value="cycles">Cycle count</option>
      </select>
      <button
        onClick={resetFilters}
        className="rounded border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-border)] px-3 py-1 text-sm"
      >
        Reset
      </button>
    </div>
  );
}
