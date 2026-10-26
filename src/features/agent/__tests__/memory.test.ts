import { beforeEach, expect, it, vi } from 'vitest';
import { memoryContext, memoryScope, retrieveMemory } from '../services/memory';
import { buildMemoryTool } from '../tools/memory';
import { approvingToolContext, TEST_LEASE } from '../../../test-utils/approvingToolContext';
import { setToolAuthorizer } from '../stores/permissions';
import type { MemoryRecord } from '../services/platform';

const ipc = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: ipc.invoke }));
const fact = (change: Partial<MemoryRecord> = {}): MemoryRecord => ({
  id: 'fact', scope: 'project:a', key: 'editor', content: 'Uses terminal editing', status: 'active', source: 'user',
  updatedAt: 10, expiresAt: Date.now() + 100_000, revision: 1, ...change,
});
beforeEach(() => { ipc.invoke.mockReset(); });

it('recalls only active, unexpired facts in the captured scope and limits the prompt', () => {
  const result = memoryContext([fact({ status: 'pending' }), fact({ expiresAt: 1 }), fact({ scope: 'project:b' }),
    fact(), fact({ id: 'duplicate' }), fact({ key: 'huge', content: 'x'.repeat(10_000) }), fact({ id: 'global', key: 'language', scope: 'global' })], 'project:a', 800);
  expect(result).toContain('untrusted historical data');
  expect(result).toContain('Uses terminal editing');
  expect(result).not.toContain('duplicate');
  expect(result).not.toContain('project:b');
  expect(result).not.toContain('huge');
  expect(memoryContext([fact()], 'project:a', 5)).toBe('');
});
it('isolates hosts, remote users and directories and never uses global scope for unknown environments', () => {
  const environment = { kind: 'ssh', cwd: '/srv/App', ssh: { host: 'one', user: 'dev' } };
  expect(memoryScope(environment)).not.toBe(memoryScope({ ...environment, ssh: { host: 'two', user: 'dev' } }));
  expect(memoryScope(environment)).not.toBe(memoryScope({ ...environment, cwd: '/srv/app' }));
  expect(memoryScope(null, 'one')).not.toBe(memoryScope(null, 'two'));
});
it('prefers the current project over a global fact with the same subject', () => {
  const result = memoryContext([fact({ id: 'global', scope: 'global', content: 'Global editor' }), fact({ content: 'Project editor' })], 'project:a');
  expect(result).toContain('Project editor');
  expect(result).not.toContain('Global editor');
});
it('does not retrieve memory for empty queries or cancelled requests', async () => {
  const controller = new AbortController(); controller.abort();
  expect(await retrieveMemory('query', 'project:a', 800, controller.signal)).toBe('');
  expect(await retrieveMemory('', 'project:a', 800)).toBe('');
  expect(ipc.invoke).not.toHaveBeenCalled();
});
it('ignores retrieval that finishes after cancellation', async () => {
  const controller = new AbortController();
  ipc.invoke.mockImplementation(async () => { controller.abort(); return [fact()]; });
  expect(await retrieveMemory('editing', 'project:a', 800, controller.signal)).toBe('');
});

function execute(input: Record<string, unknown>, context = approvingToolContext({ memoryScope: 'project:a' })) {
  const tool = buildMemoryTool(context).memory;
  return tool.execute!(input as never, { toolCallId: 'memory-call', messages: [], context: undefined as never });
}
it('queries the captured scope instead of reading whole files', async () => {
  ipc.invoke.mockResolvedValue([fact()]);
  const result = await execute({ action: 'search', query: 'editing', scope: 'project', limit: 4 });
  expect(ipc.invoke).toHaveBeenCalledWith('query_memories', { input: { scope: 'project:a', query: 'editing', limit: 4 } });
  expect(result).toMatchObject({ ok: true });
});
it('pages explicit archive review without including archives in automatic recall', async () => {
  ipc.invoke.mockResolvedValue([fact({ status: 'pending' })]);
  await execute({ action: 'read', scope: 'global', includeInactive: true, offset: 20, limit: 5 });
  expect(ipc.invoke).toHaveBeenLastCalledWith('query_memories', { input: { scope: 'global', includeInactive: true, offset: 20, limit: 5 } });
});
it('binds writes to the full payload and requires a revision for replacement', async () => {
  ipc.invoke.mockResolvedValue(fact());
  const input = { action: 'update', id: 'fact', expectedRevision: 1, key: 'editor', content: 'Updated', scope: 'project', validDays: 30, status: 'active' };
  expect(await execute(input)).toMatchObject({ ok: true });
  expect(ipc.invoke).toHaveBeenLastCalledWith('save_memory', { action: 'update', lease: TEST_LEASE, input: expect.objectContaining({
    id: 'fact', expectedRevision: 1, scope: 'project:a', key: 'editor', content: 'Updated', status: 'active',
  }) });
  ipc.invoke.mockClear();
  expect(await execute({ ...input, expectedRevision: undefined })).toMatchObject({ ok: false });
  expect(ipc.invoke).not.toHaveBeenCalled();
});
it('never writes after a denial and propagates conflicts without replacing a whole store', async () => {
  const ctx = approvingToolContext(); setToolAuthorizer(async () => ({ decision: 'deny' }));
  expect(await execute({ action: 'append', key: 'editor', content: 'New', validDays: 90, status: 'active' }, ctx)).toMatchObject({ denied: true });
  expect(ipc.invoke).not.toHaveBeenCalled();
  ipc.invoke.mockRejectedValue(new Error('Memory changed'));
  expect(await execute({ action: 'append', key: 'editor', content: 'New', validDays: 90, status: 'active' })).toMatchObject({ ok: false, error: 'Memory changed' });
});
