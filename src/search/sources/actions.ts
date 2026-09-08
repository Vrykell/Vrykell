import { Command } from 'lucide-react';
import { registerSource } from '@/search/registry';
import type { ActionResultData, SearchResult } from '@/search/types';
import { searchCommands } from '@/shared/constants/commands';

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
