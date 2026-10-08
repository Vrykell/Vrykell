import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { getSettings, searchSettings } from '../services/registry';
import { useSettingsNavigationStore } from '../stores/navigation';
import { useSessionStore } from '@features/workspace';
import { Field } from '../components/ui';

afterEach(() => { cleanup(); vi.restoreAllMocks(); useSettingsNavigationStore.getState().setSelected('ai-model'); });

it('indexes individual settings beyond page names', () => {
  expect(getSettings().length).toBeGreaterThan(30);
  expect(searchSettings('执行终端命令').map(setting => setting.id)).toEqual(['permission-run_command']);
  expect(searchSettings('文件打开方式').map(setting => setting.id)).toEqual(['file-open']);
  expect(searchSettings('opacity').map(setting => setting.id)).toEqual(['opacity']);
  expect(searchSettings('补全防抖').map(setting => setting.id)).toEqual(['completion-delay']);
  expect(searchSettings('终端字号').map(setting => setting.id)).toEqual(['terminal-font']);
  expect(searchSettings('应用不透明度').map(setting => setting.id)).toEqual(['opacity']);
});

it('opens and focuses the matching field even on an existing page', () => {
  vi.spyOn(useSessionStore.getState(), 'openSettingsTab').mockImplementation(() => {});
  render(<><Field title="终端字号"><button>Size</button></Field><Field title="应用不透明度"><input aria-label="Opacity" /></Field></>);
  act(() => getSettings().find(setting => setting.id === 'terminal-font')!.onSelect());
  expect(useSettingsNavigationStore.getState().selected).toBe('appearance-theme');
  expect(screen.getByRole('button', { name: 'Size' })).toHaveFocus();
  expect(screen.getByRole('button').closest('.settings-field')).not.toHaveAttribute('data-search-target');
  act(() => getSettings().find(setting => setting.id === 'opacity')!.onSelect());
  expect(screen.getByLabelText('Opacity')).toHaveFocus();
  expect(screen.getByLabelText('Opacity').closest('.settings-field')).not.toHaveAttribute('data-search-target');
});
