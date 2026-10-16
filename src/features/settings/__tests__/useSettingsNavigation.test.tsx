import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSettingsNavigation } from '../hooks/useSettingsNavigation';
import { useSettingsNavigationStore } from '../stores/navigation';
import { getSettings } from '../services/registry';
import { useSessionStore } from '@features/workspace';

beforeEach(() => useSettingsNavigationStore.setState({ selected: 'ai-model' }));
afterEach(() => vi.restoreAllMocks());

it('opens the globally indexed page before mounting and updates an existing settings view', () => {
  const open = vi.spyOn(useSessionStore.getState(), 'openSettingsTab').mockImplementation(() => {});
  getSettings().find(setting => setting.id === 'theme')!.onSelect();
  const { result } = renderHook(() => useSettingsNavigation());
  expect(result.current.selected).toBe('appearance-theme');
  act(() => getSettings().find(setting => setting.id === 'file-open')!.onSelect());
  expect(result.current.selected).toBe('editor-local');
  expect(open).toHaveBeenCalledTimes(2);
});

it('keeps all pages available and clears field targets when choosing a page', () => {
  const { result } = renderHook(() => useSettingsNavigation());
  expect(result.current.groups.flatMap(group => group.items)).toHaveLength(18);
  act(() => useSettingsNavigationStore.getState().openField('ai-perms', 'Permissions'));
  act(() => result.current.setSelected('terminal-open'));
  expect(result.current.selected).toBe('terminal-open');
  expect(result.current.activeLabel).toBe('打开方式');
  expect(useSettingsNavigationStore.getState().targetField).toBeNull();
  expect(result.current.groups).toHaveLength(6);
});
