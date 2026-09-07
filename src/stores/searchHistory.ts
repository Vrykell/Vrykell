import { create } from 'zustand';
import { safeJsonParse, safeLocalStorageGet, safeLocalStorageSet } from '@/lib/errorHandler';

const STORAGE_KEY = 'vrykell-search-history';
const MAX_ITEMS = 20;

function load(): string[] {
  const raw = safeLocalStorageGet(STORAGE_KEY);
  if (!raw) return [];
  const parsed = safeJsonParse<unknown>(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((v): v is string => typeof v === 'string');
}

function save(items: string[]) {
  safeLocalStorageSet(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_ITEMS)));
}

interface SearchHistoryState {
  items: string[];
  add: (query: string) => void;
  remove: (query: string) => void;
  clear: () => void;
}

export const useSearchHistoryStore = create<SearchHistoryState>((set, get) => ({
  items: load(),

  add: (query) => {
    const q = query.trim();
    if (!q) return;
    const next = [q, ...get().items.filter((i) => i !== q)];
    save(next);
    set({ items: next });
  },

  remove: (query) => {
    const next = get().items.filter((i) => i !== query);
    save(next);
    set({ items: next });
  },

  clear: () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    set({ items: [] });
  },
}));
