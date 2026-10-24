import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import CodeEditor, { type CodeEditorHandle } from '../CodeEditor';
import { useEditorPreferences } from '@config/editor';
import { useTypographyStore } from '@config/typography';
import { act } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), dispose: vi.fn(), modelDispose: vi.fn(), trigger: vi.fn(), command: vi.fn(), vim: vi.fn(), vimDispose: vi.fn(), defineEx: vi.fn(), theme: vi.fn(), diagnostic: vi.fn() }));
vi.mock('@platform/diagnostics', () => ({ diagnostic: mocks.diagnostic }));
vi.mock('../code/runtime', () => ({
  applyCodeTheme: mocks.theme, languageForFile: () => 'plaintext',
  editorApi: { KeyMod: { CtrlCmd: 2048 }, KeyCode: { KeyS: 49 }, editor: {
    create: mocks.create, ShowLightbulbIconMode: { Off: 'off' },
    createModel: (initial: string) => {
      let value = initial;
      return { getValue: () => value, setValue: (next: string) => { value = next; }, onDidChangeContent: vi.fn(), dispose: mocks.modelDispose };
    },
  } },
}));
vi.mock('monaco-vim', () => ({ default: { initVimMode: mocks.vim, VimMode: { Vim: { defineEx: mocks.defineEx } } } }));
beforeEach(() => {
  vi.clearAllMocks();
  useEditorPreferences.setState({ lineNumbers: true });
  useTypographyStore.getState().reset();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  mocks.create.mockImplementation(() => ({ updateOptions: mocks.update, dispose: mocks.dispose, layout: vi.fn(), focus: vi.fn(), addCommand: mocks.command, onDidChangeCursorPosition: vi.fn(), trigger: mocks.trigger }));
  mocks.vim.mockReturnValue({ dispose: mocks.vimDispose });
});

it('uses restrained text-editor defaults and exposes common edit commands without remounting', async () => {
  let handle: CodeEditorHandle | null = null;
  const props = { path: 'note.txt', value: 'first line', onChange: vi.fn(), onSave: vi.fn(), onReady: (next: CodeEditorHandle | null) => { handle = next; } };
  const { rerender, unmount } = render(<CodeEditor {...props} />);
  await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
  expect(mocks.create.mock.calls[0][1]).toMatchObject({ minimap: { enabled: false }, lineNumbers: 'on', lineDecorationsWidth: 16, folding: false, quickSuggestions: false, suggestOnTriggerCharacters: false });
  expect(screen.getByRole('status')).toHaveTextContent('第 1 行，第 1 列');
  expect(screen.getByRole('status')).toHaveTextContent('UTF-8');
  (handle as CodeEditorHandle | null)?.run('actions.find'); expect(mocks.trigger).toHaveBeenCalledWith('document-toolbar', 'actions.find', null);
  rerender(<CodeEditor {...props} wordWrap />);
  await waitFor(() => expect(mocks.update).toHaveBeenCalledWith({ wordWrap: 'on' }));
  expect(mocks.create).toHaveBeenCalledTimes(1);
  act(() => { useEditorPreferences.getState().update({ lineNumbers: false }); useTypographyStore.getState().update({ editorFontSize: 18, editorFontWeight: 550, editorLineHeight: 1.8, editorFontPreset: 'Maple Mono' }); });
  expect(mocks.update).toHaveBeenCalledWith({ lineNumbers: 'off' });
  expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ fontSize: 18, fontWeight: '550', lineHeight: 32.4 }));
  expect(mocks.create).toHaveBeenCalledTimes(1);
  const save = mocks.command.mock.calls[0][1] as () => void; save(); expect(props.onSave).toHaveBeenCalledTimes(1);
  unmount(); expect(mocks.dispose).toHaveBeenCalledTimes(1); expect(mocks.modelDispose).toHaveBeenCalledTimes(1);
  expect(handle).toBeNull();
});

it('adds optional modal bindings and disposes them when disabled without replacing the editor', async () => {
  const props = { path: 'note.txt', value: 'note', onChange: vi.fn(), onSave: vi.fn() };
  const { rerender } = render(<CodeEditor {...props} vimMode />);
  await waitFor(() => expect(mocks.vim).toHaveBeenCalledTimes(1));
  expect(mocks.defineEx).toHaveBeenCalledWith('write', 'w', expect.any(Function));
  const write = mocks.defineEx.mock.calls[0][2] as (adapter: { editor: unknown }) => void;
  write({ editor: mocks.create.mock.results[0].value }); await waitFor(() => expect(props.onSave).toHaveBeenCalledTimes(1));
  rerender(<CodeEditor {...props} vimMode={false} />);
  expect(mocks.vimDispose).toHaveBeenCalledTimes(1); expect(mocks.create).toHaveBeenCalledTimes(1);
});

it('reports initialization failures inline and records the runtime error for diagnostics', async () => {
  const error = new Error('Assertion failed (There is already an extension with this id)');
  mocks.theme.mockImplementationOnce(() => { throw error; });
  render(<CodeEditor path="note.txt" value="private note" onChange={vi.fn()} onSave={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('无法加载编辑器'));
  fireEvent.click(screen.getByRole('button', { name: /^技术详情$/ }));
  expect(screen.getByRole('alert')).toHaveTextContent(error.message);
  expect(mocks.diagnostic).toHaveBeenCalledWith('code-editor-load', { stage: 'error', error }, 'error');
  expect(mocks.create).not.toHaveBeenCalled();
});

it('rebinds modal editing after a draft is saved at a new path', async () => {
  const props = { value: 'note', onChange: vi.fn(), onSave: vi.fn(), vimMode: true };
  const { rerender } = render(<CodeEditor {...props} path="Untitled.txt" />);
  await waitFor(() => expect(mocks.vim).toHaveBeenCalledTimes(1));
  rerender(<CodeEditor {...props} path="/notes/saved.txt" />);
  await waitFor(() => expect(mocks.vim).toHaveBeenCalledTimes(2));
  expect(mocks.vimDispose).toHaveBeenCalledTimes(1); expect(mocks.create).toHaveBeenCalledTimes(2);
});
