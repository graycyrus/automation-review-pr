import type { Pr, Stats, FilterOptions, Job, PrFilters, CiCheck, GhPr, GhFile, GhComment } from './types';

export const GH_REPO = 'tinyhumansai/openhuman';
const GH_API = `https://api.github.com/repos/${GH_REPO}`;

async function jget<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} on ${url}`);
  return res.json();
}

async function jpost<T>(url: string): Promise<T> {
  const res = await fetch(url, { method: 'POST', cache: 'no-store' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `${res.status}`);
  }
  return res.json();
}

export const api = {
  whoami: () => jget<{ login: string | null; name: string | null }>('/api/whoami'),
  openPulls: () => jget<{ ids: number[]; cached?: boolean }>('/api/open-pulls'),
  stats: () => jget<Stats>('/api/stats'),
  filters: () => jget<FilterOptions>('/api/filters'),
  prs: (filters: PrFilters = {}) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) {
      if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
    }
    const qs = sp.toString();
    return jget<Pr[]>(`/api/prs${qs ? `?${qs}` : ''}`);
  },
  pr: (id: number) => jget<Pr>(`/api/prs/${id}`),
  prChecks: (id: number) => jget<{ checks: CiCheck[]; total: number; pass: number; fail: number; pending: number }>(`/api/prs/${id}/checks`),
  prTrackingHtml: async (id: number): Promise<string | null> => {
    const r = await fetch(`/api/prs/${id}/tracking/html`);
    return r.ok ? r.text() : null;
  },
  prLogs: (id: number) => jget<Array<{ filename: string; path: string; size: number }>>(`/api/prs/${id}/logs`),
  jobs: () => jget<Record<string, Job>>('/api/trigger/jobs'),
  jobLog: (jobId: string, after = 0) =>
    jget<{ jobId: string; done: boolean; exitCode: number | null; total: number; after: number; lines: string[] }>(
      `/api/trigger/log/${encodeURIComponent(jobId)}?after=${after}`,
    ),
  // Mutations
  triggerReview: (id: number) => jpost<{ jobId: string; message: string }>(`/api/trigger/review/${id}`),
  triggerFix: async (id: number, paneId?: string) => {
    const res = await fetch(`/api/trigger/fix/${id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify(paneId ? { pane_id: paneId } : {}),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `${res.status}`);
    }
    return res.json() as Promise<{
      pr: number;
      session: string;
      window: string;
      pane_id: string;
      workspace: string;
      attach: string;
      logFile: string;
      message: string;
    }>;
  },
  fixStatus: (id: number, lines = 400) =>
    jget<{
      running: boolean;
      mapping: { pane_id: string; window: string; workspace: string; logFile: string; started_at: string } | null;
      content: string | null;
    }>(`/api/trigger/fix/${id}?lines=${lines}`),
  fixSend: async (id: number, payload: { text?: string; key?: string }) => {
    const res = await fetch(`/api/trigger/fix/${id}/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `${res.status}`);
    }
    return res.json() as Promise<{ sent: boolean; pane_id: string }>;
  },
  listPanes: () =>
    jget<{
      session: string | null;
      panes: Array<{ pane_id: string; window: string; command: string; cwd: string; workspace: string; idle: boolean }>;
    }>('/api/trigger/panes'),
  triggerDiscover: () => jpost<{ jobId: string }>('/api/trigger/discover'),
  cancelJob: (jobId: string) => jpost<{ message: string }>(`/api/trigger/cancel/${encodeURIComponent(jobId)}`),
  approve: (id: number) => jpost<{ success: boolean; review_url?: string }>(`/api/trigger/approve/${id}`),
  unapprove: (id: number) => jpost<{ success: boolean }>(`/api/trigger/unapprove/${id}`),
  mergePreflight: (id: number) => jget<{ checks: Array<{ name: string; pass: boolean }>; allPass: boolean }>(`/api/trigger/merge-preflight/${id}`),
  merge: async (id: number, opts: { force?: boolean } = {}) => {
    const res = await fetch(`/api/trigger/merge/${id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({ force: opts.force === true }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `${res.status}`);
    }
    return res.json() as Promise<{ success: boolean; force?: boolean; message: string }>;
  },
  syncPr: (id: number) => jpost<Pr>(`/api/prs/${id}/sync`),
  syncAll: () => jpost<{ synced: number }>('/api/sync'),
};

// Public GitHub API — direct from browser (repo is public).
export const gh = {
  pr: (id: number) => jget<GhPr>(`${GH_API}/pulls/${id}`),
  files: (id: number) => jget<GhFile[]>(`${GH_API}/pulls/${id}/files?per_page=100`),
  comments: async (id: number): Promise<GhComment[]> => {
    const [issue, review] = await Promise.all([
      fetch(`${GH_API}/issues/${id}/comments?per_page=100`).then((r) => (r.ok ? r.json() : [])),
      fetch(`${GH_API}/pulls/${id}/comments?per_page=100`).then((r) => (r.ok ? r.json() : [])),
    ]);
    const all: GhComment[] = [
      ...issue.map((c: any) => ({ ...c, kind: 'issue' as const })),
      ...review.map((c: any) => ({ ...c, kind: 'review' as const })),
    ];
    return all.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  },
  diffUrl: (id: number) => `https://github.com/${GH_REPO}/pull/${id}/files`,
  prUrl: (id: number) => `https://github.com/${GH_REPO}/pull/${id}`,

  // Set of PR numbers currently open on GitHub. Used as the source of truth
  // for filtering merged/closed PRs out of the dashboard without touching the
  // local DB. Paginates up to 4 pages (400 PRs) which is plenty for this repo.
  //
  // Cached for 2 min in-memory: unauthenticated GitHub allows 60 req/hr per
  // IP, so polling every 30s would burn the budget in ~30 min. With a 2-min
  // cache, the dashboard issues at most ~30 GitHub calls/hr regardless of
  // local poll cadence.
  async openPullNumbers(): Promise<Set<number>> {
    const now = Date.now();
    if (_openPullsCache && now - _openPullsCache.at < OPEN_PULLS_TTL_MS) {
      return _openPullsCache.ids;
    }
    const ids = new Set<number>();
    for (let page = 1; page <= 4; page++) {
      const r = await fetch(`${GH_API}/pulls?state=open&per_page=100&page=${page}`);
      if (!r.ok) {
        // If we already have a stale snapshot, keep returning it instead of
        // an empty set so the UI doesn't accidentally hide everything.
        if (_openPullsCache) return _openPullsCache.ids;
        throw new Error(`${r.status} from GitHub`);
      }
      const batch: Array<{ number: number }> = await r.json();
      for (const p of batch) ids.add(p.number);
      if (batch.length < 100) break;
    }
    _openPullsCache = { ids, at: now };
    return ids;
  },
};

const OPEN_PULLS_TTL_MS = 2 * 60 * 1000;
let _openPullsCache: { ids: Set<number>; at: number } | null = null;
