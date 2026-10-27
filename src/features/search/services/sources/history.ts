import { History } from '@ui/icons';
import { registerSource } from '@features/search/services/registry';
import { searchHistory as backendSearchHistory } from '@platform/api/search';
import type { SearchResult, HistoryResultData } from '@features/search/types';
import { useHistoryStore } from '@features/terminal/stores/history';

registerSource({
  id: 'history',
  label: '命令历史',
  icon: History,
  search: async (query: string): Promise<SearchResult[]> => {
    const lower = query.toLowerCase();

    // Check the frontend hot cache first (instant)
    const localEntries = useHistoryStore
      .getState()
      .entries.filter((e) => e.command.toLowerCase().includes(lower))
      .slice(0, 10);

    // Also query the backend database (full history + frequency counts)
    const backendPromise = backendSearchHistory(query, 20).catch(() => []);

    // Render local results immediately
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

    // Wait for the backend results → merge and deduplicate
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
