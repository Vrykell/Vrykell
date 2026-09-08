import { Settings } from 'lucide-react';
import { registerSource } from '@/features/search/registry';
import type { SearchResult, SettingResultData } from '@/features/search/types';
import { searchSettings } from '@/features/settings/registry';

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
