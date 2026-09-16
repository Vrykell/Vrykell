import { History } from 'lucide-react';
import { registerSource } from '../registry';
import { searchHistory as backendSearchHistory } from '@/api/search';
import type { SearchResult, HistoryResultData } from '../types';
import { useHistoryStore } from '@/store/history';

registerSource({
  id: 'history',
  label: '命令历史',
  icon: History,
  search: async (query: string): Promise<SearchResult[]> => {
    const lower = query.toLowerCase();

    // 先查前端热缓存（instant）
    const localEntries = useHistoryStore
      .getState()
      .entries.filter((e) => e.command.toLowerCase().includes(lower))
      .slice(0, 10);

    // 同时查后端 SQLite（完整历史 + 频次统计）
    const backendPromise = backendSearchHistory(query, 20).catch(() => []);

    // 先用本地结果即时渲染
    const localResults: SearchResult[] = localEntries.map((e) => ({
      type: 'history',
      id: `local-history-${e.timestamp}`,
      title: e.command,
      subtitle: e.cwd || undefined,
      data: {
        command: e.command,
        cwd: e.cwd,
        exitCode: e.exitCode,
        timestamp: e.timestamp,
        runCount: 0,
      } as HistoryResultData,
    }));

    // 等待后端结果 → 合并去重
    const backend = await backendPromise;
    const localCommands = new Set(localEntries.map((e) => e.command));
    const backendResults: SearchResult[] = backend
      .filter((e) => !localCommands.has(e.command))
      .map((e) => ({
        type: 'history',
        id: `history-${e.id}`,
        title: e.command,
        subtitle: e.cwd || undefined,
        data: {
          command: e.command,
          cwd: e.cwd,
          exitCode: e.exit_code,
          timestamp: e.timestamp,
          runCount: e.run_count,
        } as HistoryResultData,
      }));

    return [...localResults, ...backendResults];
  },
});
