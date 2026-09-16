import { describe, expect, it, vi } from 'vitest';
import { restoreWorkspaceWithDependencies, type RestoreWorkspaceDependencies } from './restoreWorkspace';

function createDependencies(overrides: Partial<RestoreWorkspaceDependencies> = {}): RestoreWorkspaceDependencies {
  return {
    listSessions: vi.fn(async () => []),
    loadGroups: vi.fn(async () => {}),
    restoreSession: vi.fn(async () => {}),
    hasTabs: vi.fn(() => false),
    createDefaultSession: vi.fn(() => ({ id: 'default', title: '终端', kind: 'local', payload: '{}' })),
    persistSession: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('restoreWorkspaceWithDependencies', () => {
  it('按 sortOrder 恢复 active 会话，并跳过非 active 会话', async () => {
    const restored: string[] = [];
    const deps = createDependencies({
      listSessions: vi.fn(async () => [
        { id: 'inactive', title: '历史', status: 'archived', sortOrder: 0 },
        { id: 'second', title: '第二个', status: 'active', sortOrder: 2 },
        { id: 'first', title: '第一个', status: 'active', sortOrder: 1 },
      ]),
      restoreSession: vi.fn(async (session) => {
        restored.push(session.id);
      }),
      hasTabs: vi.fn(() => true),
    });

    await restoreWorkspaceWithDependencies(deps);

    expect(deps.loadGroups).toHaveBeenCalledOnce();
    expect(restored).toEqual(['first', 'second']);
    expect(deps.createDefaultSession).not.toHaveBeenCalled();
    expect(deps.persistSession).not.toHaveBeenCalled();
  });

  it('没有可恢复标签时创建并持久化默认会话', async () => {
    const deps = createDependencies();

    await restoreWorkspaceWithDependencies(deps);

    expect(deps.createDefaultSession).toHaveBeenCalledOnce();
    expect(deps.persistSession).toHaveBeenCalledWith({
      id: 'default',
      title: '终端',
      kind: 'local',
      payload: '{}',
    });
  });

  it('已有标签时不创建默认会话', async () => {
    const deps = createDependencies({ hasTabs: vi.fn(() => true) });

    await restoreWorkspaceWithDependencies(deps);

    expect(deps.createDefaultSession).not.toHaveBeenCalled();
    expect(deps.persistSession).not.toHaveBeenCalled();
  });

  it('单个恢复失败不阻断后续会话和默认会话逻辑', async () => {
    const errors: string[] = [];
    const deps = createDependencies({
      listSessions: vi.fn(async () => [
        { id: 'broken', title: '失败', status: 'active', sortOrder: 1 },
        { id: 'healthy', title: '正常', status: 'active', sortOrder: 2 },
      ]),
      restoreSession: vi.fn(async (session) => {
        if (session.id === 'broken') throw new Error('restore failed');
      }),
      hasTabs: vi.fn(() => false),
      onError: (message) => errors.push(message),
    });

    await restoreWorkspaceWithDependencies(deps);

    expect(deps.restoreSession).toHaveBeenCalledTimes(2);
    expect(deps.persistSession).toHaveBeenCalledOnce();
    expect(errors).toEqual(['恢复会话失败：broken']);
  });
});
