import { beforeEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { ToolContext } from '../stores/permissions';
import { ApplicationToolSession, applicationToolCatalog } from '../services/applicationTools';

const execute = vi.hoisted(() => vi.fn());
vi.mock('../tools', () => ({ buildTools: (context: ToolContext) => {
  const entry = { inputSchema: z.object({ path: z.string() }), execute: (args: unknown) => execute(args, context) };
  return { read_file: entry, ...(context.paneId !== null ? { run_command: entry } : {}), ask_user: entry, get_api_key: entry };
} }));
beforeEach(() => { execute.mockReset(); });

it('adapts only the application allowlist and preserves input schemas', () => {
  const catalog = applicationToolCatalog();
  expect(catalog.map(tool => tool.name)).toEqual(['read_file', 'run_command', 'ask_user']);
  expect(catalog[0]?.inputSchema.type).toBe('object');
  expect(catalog[0]?.inputSchema.required).toEqual(['path']);
});

it('validates input and never falls back from an unbound terminal to the current focus', async () => {
  const session = new ApplicationToolSession({ tabId: 'first', paneId: null }, vi.fn());
  expect((await session.call('bad', 'read_file', { path: 123 })).isError).toBe(true);
  expect((await session.call('target', 'run_command', { path: '/file' })).isError).toBe(true);
  expect(execute).not.toHaveBeenCalled();
  execute.mockResolvedValue({ ok: true });
  expect((await session.call('read', 'read_file', { path: '/file' })).isError).toBe(false);
  expect(execute.mock.calls[0]?.[1].paneId).toBeNull();
});

it('serializes calls and allows only questions after a denial without treating the answer as permission', async () => {
  let finish!: (result: unknown) => void;
  execute.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue({ ok: true });
  const session = new ApplicationToolSession({ tabId: 'first', paneId: 'fixed' }, vi.fn());
  const first = session.call('first', 'read_file', { path: '/first' });
  const second = session.call('second', 'read_file', { path: '/second' });
  await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
  finish({ ok: false, denied: true });
  expect((await first).isError).toBe(true); expect((await second).isError).toBe(true);
  expect((await session.call('question', 'ask_user', { path: '/question' })).isError).toBe(false);
  expect((await session.call('retry', 'read_file', { path: '/file' })).isError).toBe(true);
  expect(execute).toHaveBeenCalledTimes(2);
});

it('aborts a closed session without cancelling another session', async () => {
  execute.mockImplementation(async (_args, context: ToolContext) => {
    context.setToolState?.('app-mcp-first', 'approval-pending');
    return context.signal?.aborted ? { ok: false, denied: true } : { ok: true };
  });
  const first = new ApplicationToolSession({ tabId: 'first', paneId: 'one' }, vi.fn());
  const second = new ApplicationToolSession({ tabId: 'second', paneId: 'two' }, vi.fn());
  first.close();
  expect((await first.call('first', 'read_file', { path: '/file' })).isError).toBe(true);
  expect((await second.call('second', 'read_file', { path: '/file' })).isError).toBe(false);
  expect(execute).toHaveBeenCalledOnce();
});
