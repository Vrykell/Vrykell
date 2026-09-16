import { Monitor } from 'lucide-react';
import { registerSource } from '@features/search/services/registry';
import type { SearchResult, BackendSessionEntry } from '@features/search/types';
import { searchSessions } from '@/api/search';

registerSource({
  id: 'session',
  label: '会话',
  icon: Monitor,
  search: async (query: string): Promise<SearchResult[]> => {
    if (!query.trim()) return [];

    const sessions = await searchSessions(query, 10).catch(() => [] as BackendSessionEntry[]);

    return sessions.map((s: BackendSessionEntry) => ({
      type: 'session',
      id: `session-${s.id}`,
      title: s.title,
      subtitle: `${s.block_count} 个命令块`,
      detail: s.status === 'historical'
        ? `已关闭 · ${s.closed_at ? new Date(s.closed_at).toLocaleDateString() : ''}`
        : '活跃中',
      data: {
        sessionId: s.id,
        title: s.title,
        status: s.status,
        blockCount: s.block_count,
      },
    }));
  },
});
