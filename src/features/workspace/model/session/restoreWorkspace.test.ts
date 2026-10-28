import { describe, expect, it, vi } from 'vitest';
import { restoreWorkspaceWithDependencies, type RestoreWorkspaceDependencies } from '@features/workspace/model/session/restoreWorkspace';

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
  it('restores only saved terminal owners and archives leftover active records without deleting history', async () => {
    const deps = createDependencies({
      restorableSessionIds: new Set(['saved', 'mixed-owner']), archiveSession: vi.fn(async () => {}), hasTabs: () => true,
      listSessions: vi.fn(async () => [
        { id: 'saved', title: 'Saved', status: 'active', sortOrder: 0, kind: 'session' },
        { id: 'mixed-owner', title: 'Mixed owner', status: 'active', sortOrder: 1, kind: 'session' },
        { id: 'closed', title: 'Closed', status: 'active', sortOrder: 2, kind: 'session' },
        { id: 'layout', title: 'Layout', status: 'active', sortOrder: 3, kind: 'workspace' },
      ]),
    });
    await restoreWorkspaceWithDependencies(deps);
    expect(vi.mocked(deps.restoreSession).mock.calls.map(([session]) => session.id)).toEqual(['saved', 'mixed-owner']);
    expect(vi.mocked(deps.archiveSession!).mock.calls.map(([id]) => id)).toEqual(['closed', 'layout']);
  });
  it('opens a shell-requested directory without archiving or restoring saved sessions', async () => {
    const openDirectory = vi.fn();
    const deps = createDependencies({ launchDirectory: 'C:\\Work space\\project', openDirectory, startupMode: 'empty', archiveSession: vi.fn() });
    await restoreWorkspaceWithDependencies(deps);
    expect(openDirectory).toHaveBeenCalledExactlyOnceWith('C:\\Work space\\project');
    expect(deps.listSessions).not.toHaveBeenCalled();
    expect(deps.archiveSession).not.toHaveBeenCalled();
    expect(deps.createDefaultSession).not.toHaveBeenCalled();
  });
  it('does not duplicate the requested tab when startup runs again', async () => {
    const openDirectory = vi.fn();
    await restoreWorkspaceWithDependencies(createDependencies({ launchDirectory: '/tmp', openDirectory, hasTabs: () => true }));
    expect(openDirectory).not.toHaveBeenCalled();
  });
  it('restores active sessions by sortOrder and skips non-active sessions', async () => {
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

  it('creates and persists a default session when no tab can be restored', async () => {
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

  it('neither restores nor creates a default tab after choosing an empty workspace', async () => {
    const deps = createDependencies({ startupMode: 'empty' });
    await restoreWorkspaceWithDependencies(deps);
    expect(deps.restoreSession).not.toHaveBeenCalled();
    expect(deps.createDefaultSession).not.toHaveBeenCalled();
    expect(deps.persistSession).not.toHaveBeenCalled();
  });

  it('skips restoring saved sessions when the default tab page is chosen', async () => {
    const deps = createDependencies({ startupMode: 'default' });
    await restoreWorkspaceWithDependencies(deps);
    expect(deps.restoreSession).not.toHaveBeenCalled();
    expect(deps.createDefaultSession).toHaveBeenCalledOnce();
  });

  it('archives the previous active sessions into history when restore is declined', async () => {
    const archiveSession = vi.fn(async () => {});
    const deps = createDependencies({
      startupMode: 'empty',
      archiveSession,
      listSessions: vi.fn(async () => [
        { id: 'active-one', title: '终端', status: 'active', sortOrder: 0 },
        { id: 'history', title: '历史', status: 'historical', sortOrder: 1 },
      ]),
    });
    await restoreWorkspaceWithDependencies(deps);
    expect(archiveSession).toHaveBeenCalledExactlyOnceWith('active-one');
    expect(deps.restoreSession).not.toHaveBeenCalled();
    expect(deps.createDefaultSession).not.toHaveBeenCalled();
  });

  it('does not create a default session when tabs already exist', async () => {
    const deps = createDependencies({ hasTabs: vi.fn(() => true) });

    await restoreWorkspaceWithDependencies(deps);

    expect(deps.createDefaultSession).not.toHaveBeenCalled();
    expect(deps.persistSession).not.toHaveBeenCalled();
  });

  it('continues with later sessions and default-session logic after a single restore failure', async () => {
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
