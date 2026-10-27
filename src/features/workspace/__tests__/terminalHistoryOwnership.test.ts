import { beforeEach, expect, it, vi } from 'vitest';
import { getSession, listSessions } from '@platform/api/session';
import type { BackendSessionEntry } from '@platform/api/types';
import { restoreWorkspaceMember } from '../services/restoreWorkspaceHistory';
import * as sessionManager from '../services/sessionManager';
import { useWorkspaceStore } from '../stores/workspace';
import { leaf } from '../model/windowLayout';
import type { WorkspaceHistoryMember } from '../model/workspaceHistory';

vi.mock('@platform/api/session', async original => ({ ...await original<typeof import('@platform/api/session')>(), getSession: vi.fn(), listSessions: vi.fn() }));
vi.mock('../services/sessionManager', async original => ({ ...await original<typeof import('../services/sessionManager')>(), restore: vi.fn() }));
const member: WorkspaceHistoryMember = { id: 'terminal:old#1', title: 'Moved pane', kind: 'terminal', reference: 'old', paneId: 'old#1', paneCount: 1, local: true, ssh: false };
const record = (id: string, paneId: string): BackendSessionEntry => ({ id, title: id, status: 'closed', created_at: 1, closed_at: 2, block_count: 1, cwd: '/repo', group_id: null, sort_order: 0, kind: 'local', payload: JSON.stringify({ layout: leaf({ id: paneId, kind: 'local' }) }) });

beforeEach(() => { vi.clearAllMocks(); useWorkspaceStore.setState({ tabs: [], activeId: '', groups: [] }); });

it.each([true, false])('restores a transferred pane from its current persisted owner when the old owner exists: %s', async oldExists => {
  if (oldExists) vi.mocked(getSession).mockResolvedValue(record('old', 'old#0'));
  else vi.mocked(getSession).mockRejectedValueOnce(new Error('Old owner removed'));
  vi.mocked(listSessions).mockResolvedValue([record('old', 'old#0'), record('new', 'old#1')]);
  vi.mocked(sessionManager.restore).mockImplementation(async id => {
    useWorkspaceStore.setState({ tabs: [{ id, title: id, kind: 'session', layout: leaf({ id: 'old#1', kind: 'local' }) }] });
  });
  expect(await restoreWorkspaceMember(member)).toBe('terminal:old#1');
  expect(sessionManager.restore).toHaveBeenCalledWith('new', 'new');
});

it('retains the legacy primary-pane fallback when no explicit owner payload is available', async () => {
  vi.mocked(getSession).mockResolvedValue({ ...record('old', 'old#0'), payload: '{}' });
  vi.mocked(listSessions).mockResolvedValue([]);
  vi.mocked(sessionManager.restore).mockImplementation(async id => {
    useWorkspaceStore.setState({ tabs: [{ id, title: id, kind: 'session', layout: leaf({ id: 'old#0', kind: 'local' }) }] });
  });
  expect(await restoreWorkspaceMember({ ...member, id: 'terminal:old#0', paneId: 'old#0' })).toBe('terminal:old#0');
  expect(sessionManager.restore).toHaveBeenCalledWith('old', 'old');
});
