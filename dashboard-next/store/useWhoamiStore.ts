import { create } from 'zustand';
import { api } from '@/lib/api';

interface WhoamiStore {
  login: string | null;
  name: string | null;
  loaded: boolean;
  load: () => Promise<void>;
}

// Cached on the client too — we only ever fetch once per page load.
export const useWhoamiStore = create<WhoamiStore>((set, get) => ({
  login: null,
  name: null,
  loaded: false,
  load: async () => {
    if (get().loaded) return;
    try {
      const r = await api.whoami();
      set({ login: r.login, name: r.name, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
}));
