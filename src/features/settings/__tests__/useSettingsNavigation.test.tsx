import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSettingsNavigation } from '@features/settings/hooks/useSettingsNavigation';

describe('useSettingsNavigation', () => {
  it('filters groups by label and keyword and expands them while searching', () => {
    const { result } = renderHook(() => useSettingsNavigation());

    expect(result.current.visibleGroups.length).toBe(5);
    act(() => result.current.setQuery('快捷'));

    expect(result.current.normalizedQuery).toBe('快捷');
    expect(result.current.visibleGroups.map((group) => group.id)).toEqual(['shortcuts']);
    expect(result.current.visibleGroups[0]?.items[0]?.id).toBe('shortcuts');
  });

  it('toggles groups without affecting the selected page', () => {
    const { result } = renderHook(() => useSettingsNavigation());

    expect(result.current.expanded.has('ai')).toBe(true);
    act(() => result.current.toggleGroup('ai'));
    expect(result.current.expanded.has('ai')).toBe(false);

    act(() => result.current.setSelected('terminal-open'));
    expect(result.current.selected).toBe('terminal-open');
    expect(result.current.activeLabel).toBe('打开方式');
  });
});
