import { afterEach, expect, it, vi } from 'vitest';
import { invoke, sanitizeDiagnostic } from '../diagnostics';
import { readEditorFile, saveEditorFile } from '../api/editor';
import { changeGitFile } from '../api/git';

const transport = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: transport.invoke }));
afterEach(() => { Reflect.deleteProperty(window, '__TAURI_INTERNALS__'); transport.invoke.mockReset(); });

it('requests one UI lease bound to the exact shared-command payload', async () => {
  Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} });
  transport.invoke.mockResolvedValueOnce('ui-token').mockResolvedValueOnce({ ok: true });
  await invoke('save_memory', { input: { key: 'editor', content: 'current' } });
  expect(transport.invoke.mock.calls).toEqual([
    ['authorize_ui_command', { command: 'save_memory', args: { input: { key: 'editor', content: 'current' } } }],
    ['save_memory', { input: { key: 'editor', content: 'current' }, uiLease: 'ui-token' }],
  ]);
});
it('authorizes editor reads, editor saves and repository changes through their public adapters', async () => {
  Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} });
  transport.invoke.mockImplementation(async (command: string) => command === 'authorize_ui_command' ? 'ui-token' : undefined);
  const target = { path: '/repo/file.txt' };
  await readEditorFile(target);
  await saveEditorFile(target, 'Updated', 'revision');
  await changeGitFile({ cwd: '/repo' }, 'file.txt', 'stage');
  expect(transport.invoke.mock.calls.map(call => call[0])).toEqual([
    'authorize_ui_command', 'editor_read_file', 'authorize_ui_command', 'editor_save_file', 'authorize_ui_command', 'git_change_file',
  ]);
  expect(transport.invoke.mock.calls[1]).toEqual(['editor_read_file', { target, uiLease: 'ui-token' }]);
  expect(transport.invoke.mock.calls[3]).toEqual(['editor_save_file', { target, text: 'Updated', expected: 'revision', uiLease: 'ui-token' }]);
});
it('does not replace an explicit tool lease with a UI authorization', async () => {
  Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} });
  transport.invoke.mockResolvedValue(undefined);
  await invoke('save_memory', { input: { key: 'editor' }, lease: 'tool-token' });
  expect(transport.invoke).toHaveBeenCalledExactlyOnceWith('save_memory', { input: { key: 'editor' }, lease: 'tool-token' });
});
it('fails closed when UI authorization is unavailable and never exports leases or results', async () => {
  Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} });
  transport.invoke.mockRejectedValueOnce(new Error('Authorization unavailable'));
  await expect(invoke('pty_write', { id: 'terminal', data: 'command' })).rejects.toThrow('Authorization unavailable');
  expect(transport.invoke).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(sanitizeDiagnostic({ uiLease: 'private-token', parts: 'private-history', modelOutput: 'private-result' }))).not.toContain('private-');
});
