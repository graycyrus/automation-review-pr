'use client';
import { useState } from 'react';
import { Button } from './Button';
import { Toast } from './Toast';
import { PaneChooser } from './PaneChooser';
import { api } from '@/lib/api';
import type { Pr } from '@/lib/types';

type ToastMsg = { tone: 'info' | 'success' | 'error'; message: string };

export function PrActions({ pr, onAction }: { pr: Pr; onAction: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastMsg | null>(null);
  const [chooserOpen, setChooserOpen] = useState(false);

  const run = async (key: string, fn: () => Promise<unknown>, successMsg?: string) => {
    setBusy(key);
    try {
      const result: any = await fn();
      onAction();
      if (successMsg) setToast({ tone: 'success', message: successMsg });
      return result;
    } catch (e: any) {
      setToast({ tone: 'error', message: e.message });
      throw e;
    } finally {
      setBusy(null);
    }
  };

  const triggerFixWithPane = async (paneId: string | null) => {
    const result: any = await run(
      'fix',
      () => api.triggerFix(pr.id, paneId ?? undefined),
    );
    setToast({
      tone: 'success',
      message: `Fix → ${result.workspace?.split('/').pop() ?? result.workspace} (${result.window} · ${result.pane_id})`,
    });
  };

  // After any successful merge, post a personalized thank-you comment.
  // First-time contributors get a Discord invite via the welcome route.
  // Best-effort — the merge already succeeded, so we surface the result
  // through the toast but never throw back up.
  const postWelcome = async () => {
    const r = await api.welcome(pr.id);
    if (r.posted) {
      setToast({
        tone: 'success',
        message: r.first_contribution
          ? `Posted welcome + Discord invite to first-time contributor`
          : `Posted thank-you to returning contributor`,
      });
    } else if (r.skipped === 'team_member') {
      setToast({ tone: 'info', message: `Welcome comment skipped: @${r.contributor} is on the team` });
    } else if (r.error) {
      setToast({ tone: 'info', message: `Merge done. Welcome comment skipped: ${r.error.slice(0, 200)}` });
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" onClick={() => run('sync', () => api.syncPr(pr.id))} disabled={busy !== null}>
        {busy === 'sync' ? 'Syncing…' : 'Sync'}
      </Button>

      {pr.is_running ? (
        <Button size="sm" variant="red" onClick={() => run('cancel', () => api.cancelJob(`review-${pr.id}`))} disabled={busy !== null}>
          {busy === 'cancel' ? 'Cancelling…' : 'Cancel Review'}
        </Button>
      ) : (
        <Button size="sm" variant="primary" onClick={() => run('review', () => api.triggerReview(pr.id))} disabled={busy !== null}>
          {busy === 'review' ? 'Starting…' : (pr.cycles?.length ?? 0) > 0 ? 'Trigger Re-review' : 'Trigger Review'}
        </Button>
      )}

      <Button
        size="sm"
        variant="purple"
        onClick={() => setChooserOpen(true)}
        disabled={busy !== null || pr.is_fixing}
        title={pr.is_fixing ? 'Fix already running — attach in tmux' : 'Run `pnpm review fix` in a tmux pane'}
      >
        {busy === 'fix' ? 'Starting…' : pr.is_fixing ? 'Fixing…' : 'Trigger Fix'}
      </Button>

      {pr.status === 'clean' && !pr.is_running && (
        <Button size="sm" variant="green" onClick={() => run('approve', () => api.approve(pr.id))} disabled={busy !== null}>
          {busy === 'approve' ? 'Approving…' : 'Approve'}
        </Button>
      )}

      {pr.status === 'approved' && (
        <Button size="sm" variant="red" onClick={() => run('unapprove', () => api.unapprove(pr.id))} disabled={busy !== null}>
          {busy === 'unapprove' ? 'Unapproving…' : 'Unapprove'}
        </Button>
      )}

      {(pr.status === 'approved' || pr.review_decision === 'APPROVED') && !pr.is_running && (
        <Button
          size="sm"
          variant="purple"
          onClick={async () => {
            if (!confirm(`Merge PR #${pr.id}? (squash + delete branch)`)) return;
            await run('merge', () => api.merge(pr.id), `Merged #${pr.id}`);
            await postWelcome();
          }}
          disabled={busy !== null}
        >
          {busy === 'merge' ? 'Merging…' : 'Merge'}
        </Button>
      )}

      {pr.status === 'clean' && !pr.is_running && (
        <Button
          size="sm"
          variant="purple"
          onClick={async () => {
            if (!confirm(`Approve and merge PR #${pr.id}? (squash + delete branch)`)) return;
            await run('approveMerge', async () => {
              await api.approve(pr.id);
              return api.merge(pr.id);
            }, `Approved + merged #${pr.id}`);
            await postWelcome();
          }}
          disabled={busy !== null}
          title="Post an approving review and then squash-merge"
        >
          {busy === 'approveMerge' ? 'Working…' : 'Approve & Merge'}
        </Button>
      )}

      {!pr.is_running && pr.status !== 'merged' && pr.status !== 'closed' && (
        <Button
          size="sm"
          variant="red"
          onClick={async () => {
            if (!confirm(
              `Force-merge PR #${pr.id}? This bypasses branch protection and failing checks via \`gh pr merge --admin\`. Requires admin rights on the repo.`,
            )) return;
            await run('forceMerge', () => api.merge(pr.id, { force: true }), `Force-merged #${pr.id}`);
            await postWelcome();
          }}
          disabled={busy !== null}
          title="gh pr merge --squash --admin --delete-branch"
        >
          {busy === 'forceMerge' ? 'Force-merging…' : 'Force Merge'}
        </Button>
      )}

      <PaneChooser
        open={chooserOpen}
        onClose={() => setChooserOpen(false)}
        onPick={triggerFixWithPane}
      />
      {toast && <Toast tone={toast.tone} message={toast.message} onClose={() => setToast(null)} />}
    </div>
  );
}
