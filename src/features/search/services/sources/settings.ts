import { Settings } from '@ui/icons';
import { registerSource } from '@features/search/services/registry';
import { searchSettings } from '@features/settings/services/registry';
import type { SearchResult, SettingResultData } from '@features/search/types';

registerSource({
  id: 'setting',
  label: '设置',
  icon: Settings,
  search: async (query: string): Promise<SearchResult[]> => {
    const matches = searchSettings(query);
    return matches.map((s) => {
      const currentValue = s.getValue();
      return {
        type: 'setting',
        id: `setting-${s.id}`,
        title: s.label,
        subtitle: s.desc,
        detail: currentValue,
        data: {
          settingId: s.id,
          currentValue,
        } as SettingResultData,
      };
    });
  },
});
