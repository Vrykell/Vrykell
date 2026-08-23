import { create } from 'zustand';
import { recordHistory, clearHistory, searchHistory } from '../api/search';

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
  /** 启动时从 SQLite 回填热缓存（最近 200 条，去重，最近优先）——
   *  补全/上下键翻历史在重启后也应立即有料（「无 AI 也要能工作」同理要求无重启也有历史） */
  hydrate: () => Promise<void>;
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

  hydrate: async () => {
    try {
      // 空 query → LIKE '%%' 匹配全部，后端按 timestamp DESC 返回
      const rows = await searchHistory('', 200);
      const seen = new Set<string>();
      const fresh: HistoryEntry[] = [];
      for (const r of rows) {
        if (seen.has(r.command)) continue;
        seen.add(r.command);
        fresh.push({ command: r.command, cwd: r.cwd, timestamp: r.timestamp, exitCode: r.exit_code });
      }
      // 合并：会话内新记录的（record 已置前）优先，后端旧历史补后
      const cur = get().entries;
      const curCmds = new Set(cur.map((e) => e.command));
      set({ entries: [...cur, ...fresh.filter((e) => !curCmds.has(e.command))] });
    } catch {
      /* 无后端（harness/测试）静默跳过 */
    }
  },
}));
