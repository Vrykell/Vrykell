import { beforeEach, expect, it, vi } from 'vitest';
import type { editor } from 'monaco-editor';
import { bindEditorVimCommands, registerEditorVimCommands, type VimApi } from '@ui/editor/code/vimCommands';
import { writeClipboardText } from '@platform/clipboard';

vi.mock('@platform/clipboard', () => ({ writeClipboardText: vi.fn().mockResolvedValue(undefined) }));
beforeEach(() => vi.clearAllMocks());

it('registers once and dispatches commands only to the owning editor, including force and ranges', async () => {
  const api: VimApi = { defineEx: vi.fn(), map: vi.fn() };
  const first = {} as editor.IStandaloneCodeEditor; const second = {} as editor.IStandaloneCodeEditor;
  const handleFirst = vi.fn(); const handleSecond = vi.fn();
  const unbind = bindEditorVimCommands(first, handleFirst); bindEditorVimCommands(second, handleSecond);
  registerEditorVimCommands(api); registerEditorVimCommands(api);
  expect(api.defineEx).toHaveBeenCalledTimes(9);
  for (const [name, shorthand] of vi.mocked(api.defineEx).mock.calls) expect(name.startsWith(shorthand)).toBe(true);
  expect(api.map).toHaveBeenCalledWith('ZZ', ':x<CR>', 'normal');
  const quit = vi.mocked(api.defineEx).mock.calls.find(([name]) => name === 'quit')![2];
  quit({ editor: first }, { argString: '! ' }); await Promise.resolve();
  expect(handleFirst).toHaveBeenCalledWith({ action: 'quit', force: true, args: '', ranged: false });
  expect(handleSecond).not.toHaveBeenCalled();
  quit({ editor: second }, { argString: ' other.txt', line: 0 }); await Promise.resolve();
  expect(handleSecond).toHaveBeenCalledWith({ action: 'quit', force: false, args: 'other.txt', ranged: true });
  unbind(); quit({ editor: first }, {}); await Promise.resolve(); expect(handleFirst).toHaveBeenCalledTimes(1);
});

it('copies every yank to the system clipboard without replacing registers or copying black-hole operations', () => {
  const original = vi.fn(); const registers: ReturnType<NonNullable<VimApi['getRegisterController']>> = { pushText: original };
  const api: VimApi = { defineEx: vi.fn(), map: vi.fn(), getRegisterController: () => registers };
  registerEditorVimCommands(api); registerEditorVimCommands(api);
  registers.pushText('"', 'yank', 'same', true); registers.pushText('a', 'yank', 'same', true);
  registers.pushText('_', 'yank', 'secret'); registers.pushText('"', 'delete', 'removed');
  expect(original).toHaveBeenCalledTimes(4);
  expect(writeClipboardText).toHaveBeenCalledTimes(2);
  expect(writeClipboardText).toHaveBeenNthCalledWith(1, 'same\n');
  expect(writeClipboardText).toHaveBeenNthCalledWith(2, 'same\n');
});
