/**
 * api — session/search/group/workspace/downloads invoke 封装透传测试。
 */
import { describe, it, expect, vi } from 'vitest';
const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

import { createSession, archiveSession, restoreSession, updateSessionTitle, updateSessionCwd, listSessions, deleteSession } from '@platform/api/session';
import { groupsList, groupCreate, groupRename, groupSetCollapsed, groupDelete } from '@platform/api/group';
import { addWorkspace, removeWorkspace, listWorkspaces } from '@platform/api/workspace';
import { searchFiles } from '@platform/api/search';

describe('api 封装', () => {
  it('session 命令透传', async () => {
    await createSession('s1', 't', 1, '/cwd', 'local', '{}');
    expect(invokeMock).toHaveBeenLastCalledWith('create_session', { id: 's1', title: 't', timestamp: 1, cwd: '/cwd', kind: 'local', payload: '{}' });
    await archiveSession('s1', 2);
    expect(invokeMock).toHaveBeenLastCalledWith('archive_session', { id: 's1', timestamp: 2 });
    await restoreSession('s1');
    expect(invokeMock).toHaveBeenLastCalledWith('restore_session', { id: 's1' });
    await updateSessionTitle('s1', '新标题');
    expect(invokeMock).toHaveBeenLastCalledWith('update_session_title', { id: 's1', title: '新标题' });
    await updateSessionCwd('s1', '/x');
    expect(invokeMock).toHaveBeenLastCalledWith('update_session_cwd', { id: 's1', cwd: '/x' });
    invokeMock.mockResolvedValueOnce([]);
    await listSessions();
    expect(invokeMock).toHaveBeenLastCalledWith('list_sessions');
    await deleteSession('s1');
    expect(invokeMock).toHaveBeenLastCalledWith('delete_session', { id: 's1' });
  });

  it('group 命令透传', async () => {
    invokeMock.mockResolvedValueOnce([]);
    await groupsList();
    expect(invokeMock).toHaveBeenLastCalledWith('groups_list');
    await groupCreate('g1', '组', 3);
    expect(invokeMock).toHaveBeenLastCalledWith('group_create', { id: 'g1', title: '组', timestamp: 3 });
    await groupRename('g1', 'x');
    expect(invokeMock).toHaveBeenLastCalledWith('group_rename', { id: 'g1', title: 'x' });
    await groupSetCollapsed('g1', true);
    expect(invokeMock).toHaveBeenLastCalledWith('group_set_collapsed', { id: 'g1', collapsed: true });
    await groupDelete('g1');
    expect(invokeMock).toHaveBeenLastCalledWith('group_delete', { id: 'g1' });
  });

  it('workspace 命令透传', async () => {
    await addWorkspace('/a', 'a', 1);
    expect(invokeMock).toHaveBeenLastCalledWith('add_workspace', { path: '/a', name: 'a', timestamp: 1 });
    await removeWorkspace(5);
    expect(invokeMock).toHaveBeenLastCalledWith('remove_workspace', { id: 5 });
    invokeMock.mockResolvedValueOnce([]);
    await listWorkspaces();
    expect(invokeMock).toHaveBeenLastCalledWith('list_workspaces');
  });

  it('search 命令透传', async () => {
    invokeMock.mockResolvedValueOnce([]);
    await searchFiles('x');
    expect(invokeMock).toHaveBeenCalled();
  });
});
