import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { getSettings, searchSettings } from '../services/registry';
import { useSettingsNavigationStore } from '../stores/navigation';
import { useSessionStore } from '@features/workspace';
import { Field } from '../components/ui';
import { useLanguagePreferences } from '@i18n';

afterEach(() => { cleanup(); vi.restoreAllMocks(); useSettingsNavigationStore.getState().setSelected('ai-model'); useLanguagePreferences.setState({ preference: 'zh' }); });

it('indexes individual settings beyond page names', () => {
  expect(getSettings().length).toBeGreaterThan(30);
  expect(searchSettings('执行终端命令').map(setting => setting.id)).toEqual(['permission-run_command']);
  expect(searchSettings('文件打开方式').map(setting => setting.id)).toEqual(['file-open']);
  expect(searchSettings('opacity').map(setting => setting.id)).toEqual(['opacity']);
  expect(searchSettings('补全防抖').map(setting => setting.id)).toEqual(['completion-delay']);
  expect(searchSettings('终端字号').map(setting => setting.id)).toEqual(['terminal-font']);
  expect(searchSettings('应用不透明度').map(setting => setting.id)).toEqual(['opacity']);
});

it('updates indexed labels when switching language in either direction', () => {
  useLanguagePreferences.getState().setPreference('en');
  expect(searchSettings('Application language')[0]?.label).toBe('Application language');
  useLanguagePreferences.getState().setPreference('zh');
  expect(searchSettings('界面语言')[0]?.label).toBe('界面语言');
});

it('opens and focuses the matching field even on an existing page', () => {
  vi.spyOn(useSessionStore.getState(), 'openSettings').mockImplementation(() => {});
  render(<><Field title="终端字号"><button>Size</button></Field><Field title="应用不透明度"><input aria-label="Opacity" /></Field></>);
  act(() => getSettings().find(setting => setting.id === 'terminal-font')!.onSelect());
  expect(useSettingsNavigationStore.getState().selected).toBe('appearance-typography');
  expect(screen.getByRole('button', { name: 'Size' })).toHaveFocus();
  expect(screen.getByRole('button').closest('.settings-field')).not.toHaveAttribute('data-search-target');
  act(() => getSettings().find(setting => setting.id === 'opacity')!.onSelect());
  expect(useSettingsNavigationStore.getState().selected).toBe('appearance-theme');
  expect(screen.getByLabelText('Opacity')).toHaveFocus();
  expect(screen.getByLabelText('Opacity').closest('.settings-field')).not.toHaveAttribute('data-search-target');
});

it('routes the split appearance settings to their owning pages', () => {
  vi.spyOn(useSessionStore.getState(), 'openSettings').mockImplementation(() => {});
  const targets: [string, string][] = [
    ['theme', 'appearance-theme'],
    ['wallpaper', 'appearance-theme'],
    ['command-highlighting', 'appearance-typography'],
    ['terminal-font-weight', 'appearance-typography'],
    ['ui-font-family', 'appearance-typography'],
    ['editor-font-family', 'appearance-typography'],
    ['editor-font-size', 'appearance-typography'],
    ['editor-font-weight', 'appearance-typography'],
    ['editor-line-spacing', 'appearance-typography'],
    ['theme-import', 'appearance-files'],
  ];
  for (const [id, page] of targets) {
    act(() => getSettings().find(setting => setting.id === id)!.onSelect());
    expect(useSettingsNavigationStore.getState().selected, id).toBe(page);
  }
});

it('routes opening-mode settings to their owning shell profile', () => {
  vi.spyOn(useSessionStore.getState(), 'openSettings').mockImplementation(() => {});
  act(() => getSettings().find(setting => setting.id === 'open-mode-bash')!.onSelect());
  expect(useSettingsNavigationStore.getState().selected).toBe('profile:bash');
  expect(useSettingsNavigationStore.getState().targetField).toBe('打开方式');
});
