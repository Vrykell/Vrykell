import { create } from 'zustand';
import { acpHarnesses } from '@platform/api/acp';

interface UsageSourcesState {
  configured: string[];
  error: string;
  refresh: () => Promise<void>;
  replace: (names: string[]) => void;
}

let revision = 0;

export const useUsageSources = create<UsageSourcesState>(set => ({
  configured: [],
  error: '',
  refresh: async () => {
    const request = ++revision;
    try {
      const entries = await acpHarnesses();
      if (request === revision) set({ configured: [...new Set(entries.map(entry => entry.name).filter(Boolean))], error: '' });
    } catch (cause) {
      if (request === revision) set({ error: String(cause) });
    }
  },
  replace: names => {
    revision += 1;
    set({ configured: [...new Set(names.filter(Boolean))], error: '' });
  },
}));
