import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { BackendSessionEntry } from '@platform/api/types';
import { listSessions } from '@platform/api/session';
import { groupsList, groupRename } from '@platform/api/group';
import * as sessionManager from '@features/workspace/services/sessionManager';
import { useHistoryMetaStore } from '@utils/historyMeta';
import { useSessionHistory } from '../hooks/useSessionHistory';

vi.mock('@platform/api/session', () => ({ listSessions: vi.fn().mockResolvedValue([]) }));
vi.mock('@platform/api/group', () => ({ groupsList: vi.fn().mockResolvedValue([]), groupRename: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@features/workspace/services/sessionManager', () => ({ restore: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined) }));

const record = (id: string): BackendSessionEntry => ({ id, title: id, status: 'historical', kind: 'local', cwd: '/work', payload: '{}',
  created_at: 1, closed_at: 2, block_count: 0, sort_order: 0, group_id: null });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(sessionManager.remove).mockResolvedValue(undefined);
  vi.mocked(listSessions).mockResolvedValue([]);
  vi.mocked(groupsList).mockResolvedValue([]);
  sessionStorage.clear();
  useHistoryMetaStore.setState(useHistoryMetaStore.getInitialState(), true);
});
afterEach(cleanup);

it('guards locked records, retains failed annotations and refreshes once after batch deletion', async () => {
  const state = useHistoryMetaStore.getState();
  state.setLocked(['session:locked'], true);
  state.setNote('session:failed', 'Keep');
  state.setNote('session:deleted', 'Remove');
  vi.mocked(sessionManager.remove).mockImplementation(async id => {
    if (id === 'failed') throw new Error('Unavailable');
  });
  const notify = vi.fn();
  const { result } = renderHook(() => useSessionHistory({ notify }));
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(() => result.current.deleteSessions([record('locked'), record('failed'), record('deleted')]));
  expect(vi.mocked(sessionManager.remove).mock.calls.map(call => call[0])).toEqual(['failed', 'deleted']);
  expect(useHistoryMetaStore.getState().notes).toEqual({ 'session:failed': 'Keep' });
  expect(listSessions).toHaveBeenCalledTimes(2);
  expect(notify).toHaveBeenCalledWith('1 项成功，1 项失败', 'error');
  act(() => result.current.deleteHistoricalSession(record('locked')));
  expect(sessionManager.remove).toHaveBeenCalledTimes(2);
});

it('restores each matching session once in display order while retaining annotations', async () => {
  useHistoryMetaStore.getState().setLocked(['session:a'], true);
  const { result } = renderHook(() => useSessionHistory());
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(() => result.current.restoreSessions([record('a'), record('b'), record('a')]));
  expect(vi.mocked(sessionManager.restore).mock.calls.map(call => call[0])).toEqual(['a', 'b']);
  expect(useHistoryMetaStore.getState().lockedRecords['session:a']).toBe(true);
});

it('restores only the requested original members in saved tab order', async () => {
  const members = [
    { ...record('last'), group_id: 'project', sort_order: 2 },
    { ...record('first'), group_id: 'project', sort_order: 0 },
    { ...record('hidden'), group_id: 'project', sort_order: 1 },
  ];
  vi.mocked(listSessions).mockResolvedValue(members);
  const { result } = renderHook(() => useSessionHistory());
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(() => result.current.restoreSessions(members.slice(0, 2)));
  expect(vi.mocked(sessionManager.restore).mock.calls.map(call => call[0])).toEqual(['first', 'last']);
});

it('searches original names and renames the persisted group without changing membership', async () => {
  const group = { id: 'project', title: 'Project Aurora', collapsed: false, archived: true, session_count: 0, sort_order: 0, created_at: 1 };
  vi.mocked(groupsList).mockResolvedValue([group]);
  vi.mocked(listSessions).mockResolvedValue([{ ...record('one'), group_id: 'project' }]);
  const { result } = renderHook(() => useSessionHistory());
  await waitFor(() => expect(result.current.loading).toBe(false));
  act(() => result.current.setFilter({ query: 'Aurora' }));
  expect(result.current.historical.map(session => session.id)).toEqual(['one']);
  await act(() => result.current.renameOriginalGroup('project', 'Project Renamed'));
  expect(groupRename).toHaveBeenCalledWith('project', 'Project Renamed');
  expect(result.current.sessions[0].group_id).toBe('project');
});
