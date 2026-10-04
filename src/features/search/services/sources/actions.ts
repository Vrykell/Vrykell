import { Command } from '@ui/icons';
import { registerSource } from '@features/search/services/registry';
import { searchCommands } from '@app/commands';
import type { SearchResult, ActionResultData } from '@features/search/types';

registerSource({
  id: 'action',
  label: '快捷操作',
  icon: Command,
  search: async (query: string): Promise<SearchResult[]> => {
    if (!query.trim()) return [];
    const matches = searchCommands(query);
    return matches.map((c) => ({
      type: 'action',
      id: `action-${c.id}`,
      title: c.label,
      subtitle: c.desc,
      detail: c.keys,
      data: {
        commandId: c.id,
        shortcut: c.keys,
      } as ActionResultData,
    }));
  },
});
