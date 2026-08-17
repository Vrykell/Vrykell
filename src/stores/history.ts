import { create } from 'zustand';
import { recordHistory, clearHistory } from '../api/search';

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
}

/**
 * 命令历史的单一权威是后端 SQLite。
 * 前端 store 只维护会话内的热缓存（即时搜索用），不再写 localStorage，
 * 避免「localStorage + SQLite 双写」两处真相源漂移（此前 clear() 只清
 * localStorage、不清 SQLite，搜索会继续返回后端旧数据）。
 */
export const useHistoryStore = create<HistoryState>((set, get) => ({
  entries: [],

  record: (command, cwd, exitCode) => {
    const entry: HistoryEntry = { command, cwd, timestamp: Date.now(), exitCode };
    const next = [entry, ...get().entries.filter((e) => e.command !== command)];
    set({ entries: next });

    // 持久化到后端 SQLite（fire-and-forget）
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
    // 同步清空后端 SQLite，确保历史清除真正生效
    clearHistory().catch(() => {});
  },
}));
