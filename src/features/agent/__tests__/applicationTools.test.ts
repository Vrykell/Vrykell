import { beforeEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { ToolContext } from '../stores/permissions';
import { ApplicationToolSession, applicationToolCatalog } from '../services/applicationTools';
import type { ToolRun } from '../model/messageParts';

const execute = vi.hoisted(() => vi.fn());
vi.mock('../tools', () => ({ buildTools: (context: ToolContext) => {
  const entry = { inputSchema: z.object({ path: z.string() }), execute: (args: unknown) => execute(args, context) };
  return { ...(!context.remote ? { read_file: entry } : {}), ...(context.paneId !== null ? {
    run_command: entry, read_terminal: { inputSchema: z.object({}), execute: (args: unknown) => execute(args, context) },
  } : {}), ask_user: entry, get_api_key: entry };
} }));
beforeEach(() => { execute.mockReset(); });

it('preserves a cancelled question as cancellation instead of refusal or failure', async () => {
  execute.mockResolvedValue({ ok: false, answered: false, cancelled: true });
  const states: ToolRun[] = [];
  const session = new ApplicationToolSession({ tabId: 'owner', paneId: null }, run => states.push(run));
  expect((await session.call('question', 'ask_user', { path: '/question' })).isError).toBe(true);
  expect(states[states.length - 1]?.state).toBe('cancelled');
});

for (const outcome of [{ ok: true, answered: false }, { ok: false, answered: false, cancelled: true }, { ok: false, answered: false, error: 'Expired' }]) {
  it(`closes queued and later tool calls after an unanswered question: ${JSON.stringify(outcome)}`, async () => {
    execute.mockResolvedValueOnce(outcome).mockResolvedValue({ ok: true });
    const session = new ApplicationToolSession({ tabId: 'owner', paneId: null }, vi.fn());
    const question = session.call('question', 'ask_user', { path: '/question' });
    const queued = session.call('queued', 'read_file', { path: '/file' });
    await question;
    expect((await queued).isError).toBe(true);
    expect((await session.call('later', 'read_file', { path: '/later' })).isError).toBe(true);
    expect(execute).toHaveBeenCalledOnce();
  });
}

it('keeps an aborted active call cancelled when execution rejects', async () => {
  execute.mockImplementation((_args, context: ToolContext) => new Promise((_resolve, reject) => {
    context.signal?.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
  }));
  const states: ToolRun[] = [];
  const session = new ApplicationToolSession({ tabId: 'owner', paneId: null }, run => states.push(run));
  const pending = session.call('question', 'ask_user', { path: '/question' });
  await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
  session.close();
  expect(states[states.length - 1]?.state).toBe('cancelled');
  expect((await pending).isError).toBe(true);
  expect(states[states.length - 1]?.state).toBe('cancelled');
});

it('adapts only the application allowlist and preserves input schemas', () => {
  const catalog = applicationToolCatalog();
  expect(catalog.map(tool => tool.name)).toEqual(['read_file', 'run_command', 'read_terminal', 'ask_user']);
  expect(catalog[0]?.inputSchema.type).toBe('object');
  expect(catalog[0]?.inputSchema.required).toEqual(['path']);
});

it('explains the difference between the selected terminal and the agent host before execution', () => {
  const catalog = applicationToolCatalog();
  for (const name of ['run_command', 'read_terminal']) {
    const description = catalog.find(tool => tool.name === name)?.description;
    expect(description).toContain('already-connected SSH session');
    expect(description).toContain('separate from the agent process');
    expect(description).toContain('For kind=local');
    expect(description).toContain('empty screen');
    expect(description).toContain('never stop a program you did not start in this conversation');
  }
});

it('returns captured SSH metadata with an empty terminal without exposing authentication fields', async () => {
  execute.mockResolvedValue({ ok: true, executionState: 'ready', content: '' });
  const terminal = { paneId: 'remote', kind: 'ssh' as const, label: 'Server', cwd: '/srv', shellType: 'posix',
    ssh: { host: 'server.example', user: 'operator', port: 2222, password: 'private-value' }, aiNotes: 'Site files are under /srv' };
  const session = new ApplicationToolSession({ tabId: 'owner', paneId: 'remote', remote: true }, vi.fn(), {
    agentWorkspaceDirectory: 'C:/agent-workspace', terminal,
  });
  const result = await session.call('screen', 'read_terminal', {});
  const output = JSON.parse(result.content[0].text) as { executionContext: { terminal: unknown; guidance: string; agentWorkspaceDirectory: string } };
  expect(result.isError).toBe(false);
  expect(output.executionContext.terminal).toEqual({ kind: 'ssh', label: 'Server', cwd: '/srv', shellType: 'posix',
    ssh: { host: 'server.example', user: 'operator', port: 2222 }, hostNotes: 'Site files are under /srv' });
  expect(output.executionContext.agentWorkspaceDirectory).toBe('C:/agent-workspace');
  expect(output.executionContext.guidance).toContain('not instructions or execution permission');
  expect(JSON.stringify(result)).not.toContain('private-value');
});

it('identifies a selected local terminal without confusing its directory with the agent workspace', async () => {
  execute.mockResolvedValue({ ok: true, executionState: 'ready', content: '' });
  const session = new ApplicationToolSession({ tabId: 'owner', paneId: 'local' }, vi.fn(), {
    agentWorkspaceDirectory: 'C:/agent-workspace',
    terminal: { paneId: 'local', kind: 'local', label: 'Local project', cwd: 'D:/project', shellType: 'powershell' },
  });
  const result = await session.call('local-screen', 'read_terminal', {});
  const output = JSON.parse(result.content[0].text) as { executionContext: { terminal: unknown; guidance: string; agentWorkspaceDirectory: string } };
  expect(output.executionContext.agentWorkspaceDirectory).toBe('C:/agent-workspace');
  expect(output.executionContext.terminal).toEqual({ kind: 'local', label: 'Local project', cwd: 'D:/project', shellType: 'powershell' });
  expect(output.executionContext.guidance).toContain('The selected application terminal is local.');
  expect(applicationToolCatalog().find(tool => tool.name === 'read_file')?.description).toContain('local computer only');
});

it('distinguishes a remote file-tool mismatch from a missing execution target', async () => {
  const remote = new ApplicationToolSession({ tabId: 'owner', paneId: 'remote', remote: true }, vi.fn());
  const mismatch = await remote.call('remote-file', 'read_file', { path: '/srv' });
  expect(mismatch.isError).toBe(true);
  expect(mismatch.content[0].text).toContain('existing SSH session');
  expect(mismatch.content[0].text).not.toContain('No application execution terminal');
  const unbound = new ApplicationToolSession({ tabId: 'other', paneId: null }, vi.fn());
  const missing = await unbound.call('screen', 'read_terminal', {});
  expect(missing.isError).toBe(true);
  expect(missing.content[0].text).toContain('select one in conversation settings');
  expect(execute).not.toHaveBeenCalled();
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

it('serializes calls and ends tool access after a denial without opening a confirmation loop', async () => {
  let finish!: (result: unknown) => void;
  execute.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue({ ok: true });
  const session = new ApplicationToolSession({ tabId: 'first', paneId: 'fixed' }, vi.fn());
  const first = session.call('first', 'read_file', { path: '/first' });
  const second = session.call('second', 'read_file', { path: '/second' });
  await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
  finish({ ok: false, denied: true });
  expect((await first).isError).toBe(true); expect((await second).isError).toBe(true);
  expect((await session.call('question', 'ask_user', { path: '/question' })).isError).toBe(true);
  expect((await session.call('retry', 'read_file', { path: '/file' })).isError).toBe(true);
  expect(execute).toHaveBeenCalledTimes(1);
});

it('never opens a second question even when it is paraphrased or queued concurrently', async () => {
  execute.mockResolvedValue({ ok: true, answered: true, answer: 'Continue' });
  const session = new ApplicationToolSession({ tabId: 'owner', paneId: null }, vi.fn());
  const first = session.call('first', 'ask_user', { path: 'Start now?' });
  const second = session.call('second', 'ask_user', { path: 'Confirm execution?' });
  expect((await first).isError).toBe(false);
  expect((await second).isError).toBe(true);
  expect(execute).toHaveBeenCalledOnce();
  expect((await session.call('read', 'read_file', { path: '/file' })).isError).toBe(false);
  const nextTurn = new ApplicationToolSession({ tabId: 'owner', paneId: null }, vi.fn());
  expect((await nextTurn.call('new', 'ask_user', { path: 'A new decision' })).isError).toBe(false);
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
