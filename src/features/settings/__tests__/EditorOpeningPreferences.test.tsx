import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useEditorPreferences } from '@config/editor';
import EditorOpeningPreferences from '../components/EditorOpeningPreferences';
import EditorPreferences from '../components/EditorPreferences';
import FontSettings from '../components/FontSettings';
import { useTypographyStore } from '@config/typography';

vi.mock('../components/SettingsSaveProvider', () => ({ useSettingsSave: () => ({ save: async (action: () => void) => action() }) }));
afterEach(() => useEditorPreferences.setState({ vimMode: false }));

it('keeps file-opening destinations separate from the shared editor preferences', async () => {
  const { rerender } = render(<EditorOpeningPreferences remote={false} />);
  expect(screen.queryByRole('switch')).toBeNull();
  fireEvent.click(screen.getByRole('combobox', { name: '首选文件编辑器' }));
  fireEvent.click(screen.getByRole('option', { name: '终端编辑器' }));
  expect(useEditorPreferences.getState().localOpenMode).toBe('terminal');
  rerender(<EditorOpeningPreferences remote />);
  expect(screen.getByRole('combobox')).toHaveTextContent('内置编辑器');
  expect(screen.queryByRole('switch')).toBeNull();
  rerender(<EditorPreferences />);
  expect(screen.queryByRole('combobox', { name: '编辑器字体' })).toBeNull();
  fireEvent.click(screen.getByRole('switch', { name: 'Vim 模式' }));
  await waitFor(() => expect(useEditorPreferences.getState().vimMode).toBe(true));
  expect(screen.getByRole('switch', { name: 'Vim 模式' })).toHaveAttribute('aria-checked', 'true');
  expect(JSON.parse(localStorage.getItem('vrykell-editor-preferences')!).state.vimMode).toBe(true);
});

it('adjusts editor typography independently and resets only editor metrics', () => {
  useTypographyStore.getState().update({ terminalFontSize: 17, chatFontSize: 16 });
  render(<FontSettings />);
  for (const [name, option] of [['编辑器字体', 'JetBrains Mono'], ['编辑器字号', '18px'], ['编辑器字重', '550'], ['编辑器行距', '1.8×']]) {
    fireEvent.click(screen.getByRole('combobox', { name })); fireEvent.click(screen.getByRole('option', { name: option }));
  }
  expect(useTypographyStore.getState()).toMatchObject({ terminalFontSize: 17, chatFontSize: 16, editorFontPreset: 'JetBrains Mono', editorFontSize: 18, editorFontWeight: 550, editorLineHeight: 1.8 });
  fireEvent.click(screen.getByRole('button', { name: '恢复编辑器字体设置' }));
  expect(useTypographyStore.getState()).toMatchObject({ terminalFontSize: 17, chatFontSize: 16, editorFontPreset: 'system', editorFontSize: 13, editorFontWeight: 400, editorLineHeight: 1.5 });
});
