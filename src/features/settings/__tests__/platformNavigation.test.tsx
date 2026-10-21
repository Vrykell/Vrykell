import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import { useSettingsNavigation } from '../hooks/useSettingsNavigation';
import { useSettingsNavigationStore } from '../stores/navigation';
import { getSettings, searchSettings } from '../services/registry';
import { isSettingsPageAvailable } from '../model/navigation';

vi.mock('@platform/runtime', () => ({ isWindows: false, isMacOS: true, isLinux: false, usesCustomWindowControls: false }));
const snapshot = useSettingsNavigationStore.getState();
afterEach(() => { cleanup(); useSettingsNavigationStore.setState(snapshot, true); });

it('omits unsupported system integration from navigation and global settings search', () => {
  const { result } = renderHook(useSettingsNavigation);
  expect(result.current.groups.flatMap(group => group.items).some(item => item.id === 'context-menu')).toBe(false);
  expect(getSettings().some(item => item.page === 'context-menu')).toBe(false);
  expect(searchSettings('Windows context menu')).toEqual([]);
  expect(isSettingsPageAvailable('context-menu', true)).toBe(true);
  expect(isSettingsPageAvailable('appearance-theme', false)).toBe(true);
});

it('redirects an unavailable restored destination to a supported page', () => {
  useSettingsNavigationStore.setState({ selected: 'context-menu' });
  const { result } = renderHook(useSettingsNavigation);
  expect(result.current.selected).toBe('application-language');
  expect(result.current.activeLabel).toBe('语言');
});
