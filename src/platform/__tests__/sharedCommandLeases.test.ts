import { afterEach, expect, it, vi } from 'vitest';
import { invoke, sanitizeDiagnostic } from '../diagnostics';

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
