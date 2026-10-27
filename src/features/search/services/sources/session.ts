import { t } from '@i18n';
import { sessionCommandCount } from '@features/session-history';
import { Monitor } from '@ui/icons';
import { registerSource } from '@features/search/services/registry';
import type { BackendSessionEntry } from '@platform/api/types';
import type { SearchResult } from '@features/search/types';
import { searchSessions } from '@platform/api/search';

registerSource({
  id: 'session',
  label: t('Sessions'),
  icon: Monitor,
  search: async (query: string): Promise<SearchResult[]> => {
    if (!query.trim()) return [];

    const sessions = await searchSessions(query, 10).catch(() => [] as BackendSessionEntry[]);

    return sessions.map((s: BackendSessionEntry) => {
      const count = sessionCommandCount(s);
      return {
        type: 'session',
        id: `session-${s.id}`,
        title: s.title,
        subtitle: count === null ? undefined : t('{{count}} command blocks', { count }),
        detail: s.status === 'historical'
          ? t('Closed · {{date}}', { date: s.closed_at ? new Date(s.closed_at).toLocaleDateString() : '' })
          : t('Active'),
        data: {
          sessionId: s.id,
          title: s.title,
          status: s.status,
          blockCount: s.block_count,
        },
      };
    });
  },
});
