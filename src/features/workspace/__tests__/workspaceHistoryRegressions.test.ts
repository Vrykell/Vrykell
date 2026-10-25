import { beforeEach, expect, it, vi } from 'vitest';
import { clearWorkspaceHistorySuppression, createWorkspaceHistoryWriter, suppressWorkspaceHistory } from '../services/workspaceHistory';
import { restoreWorkspaceMember } from '../services/restoreWorkspaceHistory';
import { currentWorkspaceResources } from '../services/workspaceResources';
import { useWorkspaceStore } from '../stores/workspace';
import { useChatStore } from '@features/chat/stores/chat';
import { useAiWorkspace } from '@features/chat/stores/aiWorkspace';
import { useHarnessWorkspace } from '@features/chat/stores/harnessWorkspace';
import { saveWorkspaceHistory } from '@platform/api/historyPage';
import { leaf } from '../model/windowLayout';
import type { WorkspaceHistoryMember, WorkspaceHistorySnapshot } from '../model/workspaceHistory';

vi.mock('@platform/diagnostics', () => ({ invoke: vi.fn(async () => undefined), diagnostic: vi.fn() }));
vi.mock('@platform/api/historyPage', () => ({ saveWorkspaceHistory: vi.fn().mockResolvedValue(undefined) }));

const snapshot = (): WorkspaceHistorySnapshot => ({ version: 1, focused: 'first',
  layout: { type: 'split', direction: 'row', ratio: 0.5, first: { type: 'pane', id: 'first', resourceId: 'terminal:one#0' }, second: { type: 'pane', id: 'second', resourceId: 'chat:two' } },
  members: [{ id: 'terminal:one#0', title: 'Shell', kind: 'terminal', reference: 'one', paneId: 'one#0', paneCount: 1, local: true, ssh: false },
    { id: 'chat:two', title: 'Chat', kind: 'conversation', reference: 'two', paneCount: 1, local: false, ssh: false }] });

beforeEach(() => {
  vi.clearAllMocks();
  useWorkspaceStore.setState({ tabs: [{ id: 'one', title: 'Shell', kind: 'session', layout: leaf({ id: 'one#0', kind: 'local', shellType: 'zsh' }) }], activeId: 'one' });
  useChatStore.setState({ conversations: [{ id: 'two', title: 'Chat', createdAt: 1, updatedAt: 2, environment: null }], conversationsLoaded: true, conversationsLoading: false, byTab: { two: [] } });
  useAiWorkspace.setState({ nativeTabs: [], selected: '', order: [] });
  useHarnessWorkspace.setState({ connections: [], selected: '' });
});

it('writes a manual composition title and keeps a suppressed deleted record removed', async () => {
  const identity = { id: 'workspace:manual', createdAt: 1 };
  const writer = createWorkspaceHistoryWriter(vi.fn());
  await writer(snapshot(), identity, 'Manual name');
  expect(vi.mocked(saveWorkspaceHistory)).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Manual name', id: 'workspace:manual' }));
  suppressWorkspaceHistory(identity.id);
  const suppressed = snapshot(); if (suppressed.layout.type === 'split') suppressed.layout.ratio = 0.6;
  await writer(suppressed, identity, 'Manual name');
  expect(saveWorkspaceHistory).toHaveBeenCalledOnce();
  clearWorkspaceHistorySuppression(identity.id);
  await writer(suppressed, identity, 'Manual name');
  expect(saveWorkspaceHistory).toHaveBeenCalledTimes(2);
});

it('restores each comparison member as its own live comparison resource', async () => {
  const comparison = (path: string): WorkspaceHistoryMember => ({ id: `diff:${path}`, title: path, kind: 'comparison',
    reference: path, cwd: '/repo', scope: 'unstaged', paneCount: 1, local: true, ssh: false });
  const first = await restoreWorkspaceMember(comparison('first.ts'));
  const second = await restoreWorkspaceMember(comparison('second.ts'));
  expect(second).not.toBe(first);
  const resources = currentWorkspaceResources().filter(resource => resource.kind === 'comparison');
  expect(resources.map(resource => resource.id).sort()).toEqual([first, second].sort());

  useWorkspaceStore.setState({ tabs: [{
    id: 'page', kind: 'git-diff', title: 'Comparison', selection: { target: { cwd: '/repo' }, paneId: '', path: 'open.ts', scope: 'unstaged' },
    comparisons: [{ id: 'page', selection: { target: { cwd: '/repo' }, paneId: '', path: 'open.ts', scope: 'unstaged' } }],
  }], activeId: 'page' });
  const restored = await restoreWorkspaceMember(comparison('third.ts'));
  const page = useWorkspaceStore.getState().tabs.find(tab => tab.kind === 'git-diff');
  const item = page?.kind === 'git-diff' ? page.comparisons?.find(comparison => comparison.selection.path === 'third.ts') : undefined;
  expect(item && `diff:${item.id}`).toBe(restored);
});
