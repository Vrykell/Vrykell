import { create } from 'zustand';
import { recordHistory, clearHistory, searchHistory } from '@platform/api/search';

interface HistoryEntry {
  command: string;
  cwd: string;
  timestamp: number;
  exitCode: number | null;
}

interface HistoryState {
  entries: HistoryEntry[];
  record: (command: string, cwd: string, exitCode: number | null) => void;
  search: (prefix: string, limit?: number) => HistoryEntry[];
  clear: () => void;
  /** Backfill the hot cache from the backend at startup (latest 200, deduplicated, newest first)
   *  so completion and history recall work immediately after a restart. */
  hydrate: () => Promise<void>;
}

/**
 * The backend database is the single source of truth for command history.
 * This store keeps only an in-session hot cache for instant search and never
 * writes browser storage, so the two copies cannot drift apart.
 */
export const useHistoryStore = create<HistoryState>((set, get) => ({
  entries: [],

  record: (command, cwd, exitCode) => {
    const entry: HistoryEntry = { command, cwd, timestamp: Date.now(), exitCode };
    const next = [entry, ...get().entries.filter((e) => e.command !== command)];
    set({ entries: next });

    // Persist to the backend database (fire-and-forget)
    recordHistory(command, cwd, exitCode, entry.timestamp).catch(() => {});
  },

  search: (prefix, limit = 20) => {
    const lower = prefix.toLowerCase();
    return get()
      .entries.filter((e) => e.command.toLowerCase().includes(lower))
      .slice(0, limit);
  },

  clear: () => {
    set({ entries: [] });
    // Clear the backend database too, so cleared history does not come back
    clearHistory().catch(() => {});
  },

  hydrate: async () => {
    try {
      // An empty query matches everything; the backend returns rows by timestamp DESC
      const rows = await searchHistory('', 200);
      const seen = new Set<string>();
      const fresh: HistoryEntry[] = [];
      for (const r of rows) {
        if (seen.has(r.command)) continue;
        seen.add(r.command);
        fresh.push({ command: r.command, cwd: r.cwd, timestamp: r.timestamp, exitCode: r.exit_code });
      }
      // Merge: keep in-session entries first (record already prepends), then append older backend history
      const cur = get().entries;
      const curCmds = new Set(cur.map((e) => e.command));
      set({ entries: [...cur, ...fresh.filter((e) => !curCmds.has(e.command))] });
    } catch {
      /* No backend available (test harness): skip silently */
    }
  },
}));
