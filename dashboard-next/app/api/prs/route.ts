import { NextRequest, NextResponse } from 'next/server';
import { db, sync, triggerJobs, tmux } from '@/lib/server-deps';

export const dynamic = 'force-dynamic';

const FILTER_KEYS = [
  'status', 'author', 'member', 'draft', 'mergeable', 'review_decision',
  'label', 'has_review', 'has_findings', 'merge_state', 'is_open',
  'assignee', 'reviewer', 'search', 'min_additions', 'max_additions',
  'min_deletions', 'max_deletions', 'created_after', 'created_before',
  'ci_status', 'sort', 'order',
];

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const filters: Record<string, any> = {};
  for (const k of FILTER_KEYS) {
    const v = sp.get(k);
    if (v !== null && v !== '') filters[k] = v;
  }
  if (sp.get('include_merged') === '1') filters.include_merged = true;

  const prs = db.queryPrs(filters);
  const liveStatus = sync.getLiveStatus();
  const activeJobs = triggerJobs.activeJobs;

  const enriched = prs.map((pr: any) => {
    const job = activeJobs.get(`review-${pr.id}`);
    const statusRunning = liveStatus && liveStatus.running && liveStatus.pr === pr.id;
    const tmuxRunning = tmux.isRunning(pr.id);
    const tmuxWindow = tmux.hasWindow(pr.id) ? `${tmux.SESSION}:pr-${pr.id}` : null;
    const isRunning = job ? !job.done : tmuxRunning || statusRunning;
    return { ...pr, is_running: isRunning, tmux_window: tmuxWindow };
  });

  return NextResponse.json(enriched);
}
