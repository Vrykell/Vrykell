import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSettingsNavigation } from '@features/settings/hooks/useSettingsNavigation';
import { useSettingsNavigationStore } from '../stores/navigation';
import { getSettings } from '../services/registry';
import { useSessionStore } from '@features/workspace';

describe('useSettingsNavigation', () => {
  beforeEach(() => useSettingsNavigationStore.setState({ selected: 'ai-model' }));
  afterEach(() => vi.restoreAllMocks());

  it('opens the indexed page before mounting and updates an existing settings view', () => {
    const open = vi.spyOn(useSessionStore.getState(), 'openSettingsTab').mockImplementation(() => {});
    getSettings().find(setting => setting.id === 'theme')!.onSelect();
    const { result } = renderHook(() => useSettingsNavigation());
    expect(result.current.selected).toBe('appearance-theme');
    act(() => getSettings().find(setting => setting.id === 'file-open')!.onSelect());
    expect(result.current.selected).toBe('editor-local');
    expect(open).toHaveBeenCalledTimes(2);
    open.mockRestore();
  });
  it('filters navigation groups by label and keyword', () => {
    const { result } = renderHook(() => useSettingsNavigation());

    expect(result.current.visibleGroups.length).toBe(6);
    act(() => result.current.setQuery('快捷'));

    expect(result.current.normalizedQuery).toBe('快捷');
    expect(result.current.visibleGroups.map((group) => group.id)).toEqual(['shortcuts']);
    expect(result.current.visibleGroups[0]?.items[0]?.id).toBe('shortcuts');
  });

  it('keeps all navigation pages visible and updates the selected page', () => {
    const { result } = renderHook(() => useSettingsNavigation());
    expect(result.current.visibleGroups.flatMap(group => group.items)).toHaveLength(18);
    act(() => result.current.setSelected('terminal-open'));
    expect(result.current.selected).toBe('terminal-open');
    expect(result.current.activeLabel).toBe('打开方式');
    expect(result.current.visibleGroups.flatMap(group => group.items)).toHaveLength(18);
  });

  it('finds individual fields using the same index as global search', () => {
    const { result } = renderHook(() => useSettingsNavigation());
    act(() => result.current.setQuery('补全防抖'));
    expect(result.current.matchingSettings.map(setting => setting.id)).toEqual(['completion-delay']);
    act(() => result.current.setQuery('opacity'));
    expect(result.current.matchingSettings.map(setting => setting.id)).toEqual(['opacity']);
    act(() => result.current.setQuery(''));
    expect(result.current.matchingSettings).toEqual([]);
  });
});
