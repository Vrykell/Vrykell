import { Command } from '@ui/icons';
import { registerSource } from '@features/search/services/registry';
import { searchCommands } from '@app/commands';
import { t } from '@i18n';
import type { SearchResult, ActionResultData } from '@features/search/types';

registerSource({
  id: 'action',
  label: t('Quick actions'),
  icon: Command,
  search: async (query: string): Promise<SearchResult[]> => {
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
