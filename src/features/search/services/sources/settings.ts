import { Settings } from '@ui/icons';
import { registerSource } from '@features/search/services/registry';
import { searchSettings } from '@features/settings/services/registry';
import type { SearchResult, SettingResultData } from '@features/search/types';

registerSource({
  id: 'setting',
  label: '设置',
  icon: Settings,
  search: async (query: string): Promise<SearchResult[]> => {
    if (!query.trim()) return [];
    const matches = searchSettings(query);
    return matches.map((s) => ({
      type: 'setting',
      id: `setting-${s.id}`,
      title: s.label,
      subtitle: s.desc,
      detail: s.getValue(),
      data: {
        settingId: s.id,
        currentValue: s.getValue(),
      } as SettingResultData,
    }));
  },
});
