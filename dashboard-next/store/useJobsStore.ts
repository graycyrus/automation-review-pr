import { create } from 'zustand';
import { api } from '@/lib/api';
import type { Job } from '@/lib/types';

interface JobsStore {
  jobs: Record<string, Job>;
  liveLogs: Record<string, { lines: string[]; done: boolean; exitCode: number | null }>;
  refresh: () => Promise<void>;
  startTailing: (jobId: string, onUpdate?: () => void) => () => void;
}

export const useJobsStore = create<JobsStore>((set, get) => ({
  jobs: {},
  liveLogs: {},

  refresh: async () => {
    try {
      const jobs = await api.jobs();
      set({ jobs });
    } catch {}
  },

  startTailing: (jobId, onUpdate) => {
    let after = 0;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      try {
        const data = await api.jobLog(jobId, after);
        after = data.total;
        set((s) => ({
          liveLogs: {
            ...s.liveLogs,
            [jobId]: {
              lines: [...(s.liveLogs[jobId]?.lines ?? []), ...data.lines],
              done: data.done,
              exitCode: data.exitCode,
            },
          },
        }));
        onUpdate?.();
        if (data.done) return;
      } catch {}
      if (!cancelled) setTimeout(tick, 1500);
    };
    tick();
    return () => { cancelled = true; };
  },
}));
