import { beforeEach, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from '../stores/workspace';
import { useWorkbenchStore } from '../stores/workbench';
import { leaf, splitLeaf } from '../model/windowLayout';
import { currentWorkspaceResources, deleteWorkspaceResource, workspacePaneResource, renameWorkspaceResource } from '../services/workspaceResources';
import { captureWorkspaceHistory, workspaceHistoryMember, createWorkspaceHistoryWriter, persistContainerHistory, suppressWorkspaceHistory, clearWorkspaceHistorySuppression, releaseContainerHistory, settleContainerHistory } from '../services/workspaceHistory';
import { useChatStore } from '@features/chat/stores/chat';
import { useAiWorkspace } from '@features/chat/stores/aiWorkspace';
import { useHarnessWorkspace } from '@features/chat/stores/harnessWorkspace';
import { useHarnessStore, type HarnessSession } from '@features/chat/stores/harness';
import { useHarnessSessionRefs } from '@features/chat/stores/harnessSessions';
import { useBlockStore } from '@features/terminal/stores/blocks';
import { deleteSession, deleteTerminalPanes } from '@platform/api/session';
import { saveWorkspaceHistory } from '@platform/api/historyPage';
import { sessionSetGroup } from '@platform/api/group';
import { t } from '@i18n';
import type { WorkspaceResource } from '../model/workspaceResources';
import type { WorkspaceHistorySnapshot } from '../model/workspaceHistory';
import type { WorkspaceContainer } from '../model/workbench';

vi.mock('@platform/diagnostics', () => ({ invoke: vi.fn(async () => undefined), diagnostic: vi.fn() }));
vi.mock('@platform/api/historyPage', () => ({ saveWorkspaceHistory: vi.fn(async () => {}) }));
vi.mock('@platform/api/session', async original => ({ ...await original<typeof import('@platform/api/session')>(), deleteSession: vi.fn(async () => {}), deleteTerminalPanes: vi.fn(async () => {}) }));
vi.mock('@platform/api/group', async original => ({ ...await original<typeof import('@platform/api/group')>(), sessionSetGroup: vi.fn(async () => {}) }));
const doc: WorkspaceResource = { id: 'file:a', title: 'A', kind: 'document', file: { path: '/a' } };
const chat: WorkspaceResource = { id: 'chat:c', title: 'C', kind: 'conversation', sessionId: 'c' };
const agent: WorkspaceResource = { id: 'acp:a', title: 'Agent', kind: 'agent', sessionId: 'a' };
const term: WorkspaceResource = { id: 'terminal:s#0', title: 'Shell', kind: 'terminal', tabId: 's', paneId: 's#0' };
const snapshot = (): WorkspaceHistorySnapshot => ({ version: 1, focused: 'a', layout: { type: 'pane', id: 'a', resourceId: doc.id }, members: [workspaceHistoryMember(doc)!] });
const historySnapshot = (): WorkspaceHistorySnapshot => ({ version: 1, focused: 'a', layout: { type: 'pane', id: 'a', resourceId: chat.id }, members: [workspaceHistoryMember(chat)!] });
const container = (id: string): WorkspaceContainer => ({ id, scope: 'ai', layout: historySnapshot().layout, focused: 'a' });
beforeEach(() => {
  vi.clearAllMocks();
  useWorkspaceStore.setState({ tabs: [], activeId: '', groups: [] });
  useChatStore.setState({ conversations: [], byTab: {}, persistenceError: null });
  useAiWorkspace.setState({ nativeTabs: [], selected: '', sideSessions: [], sideSelected: '' });
  useHarnessWorkspace.setState({ connections: [], selected: '' });
  useHarnessStore.setState({ byTab: {} }); useBlockStore.setState({ byTab: {} });
});

it('keeps the resource protocol consistent for system pages, documents and terminal aliases', async () => {
  useWorkspaceStore.setState({ tabs: [{ id: 'history', title: 'History', kind: 'history' }, { id: 's', title: 'Shell', kind: 'session', layout: leaf({ id: 's#0', kind: 'local' }) }], activeId: 's' });
  const page = currentWorkspaceResources().find(resource => resource.kind === 'page')!;
  const adapter = workspacePaneResource(page); expect(adapter.capabilities).toEqual({ split: false, rename: false, persist: false });
  expect(adapter.serialize()).toBeNull(); adapter.activate(); expect(useWorkspaceStore.getState().activeId).toBe('history'); adapter.requestClose();
  const alias = { ...term, paneId: undefined };
  workspacePaneResource(alias).activate(); await deleteWorkspaceResource(alias); expect(deleteSession).toHaveBeenCalledWith('s');
  renameWorkspaceResource(doc, 'Ignored'); renameWorkspaceResource(term, 'Shell');
  useChatStore.setState({ conversations: [{ id: 'c', title: 'C', createdAt: 1, updatedAt: 1, environment: null }] });
  renameWorkspaceResource(chat, 'Named'); expect(useChatStore.getState().conversations[0]!.title).toBe('Named');
});

it('deletes just one terminal pane while its sibling keeps both its live owner and history', async () => {
  useWorkspaceStore.setState({ tabs: [{ id: 's', title: 'Shell', kind: 'session', layout: splitLeaf(leaf({ id: 's#0', kind: 'local' }), 's#0', 'row', 'second', { id: 's#1', kind: 'local' }) }], activeId: 's' });
  await workspacePaneResource(term).delete(); expect(deleteTerminalPanes).toHaveBeenCalledWith('s', ['s#0']); expect(deleteSession).not.toHaveBeenCalled();
  await deleteWorkspaceResource({ ...term, id: 'terminal:s#1', paneId: 's#1' }); expect(deleteSession).toHaveBeenCalledWith('s');
});

it('retains failed conversation deletion for retry and forgets durable agent references before teardown', async () => {
  useChatStore.setState({ conversations: [{ id: 'c', title: 'C', createdAt: 1, updatedAt: 1, environment: null }] });
  const remove = vi.spyOn(useChatStore.getState(), 'deleteConversation').mockResolvedValue(undefined);
  await expect(deleteWorkspaceResource(chat)).rejects.toThrow(t('The conversation could not be deleted.'));
  useChatStore.setState({ persistenceError: 'offline' }); await expect(deleteWorkspaceResource(chat)).rejects.toThrow('offline'); remove.mockRestore();
  const forget = vi.spyOn(useHarnessSessionRefs.getState(), 'forget');
  useHarnessWorkspace.setState({ connections: [{ id: 'a', harness: 'Agent', cwd: '/work', fresh: false }] });
  useHarnessStore.setState({ byTab: { a: { harness: 'Agent', resumeSessionId: 'saved', messages: [] } as unknown as HarnessSession } });
  await deleteWorkspaceResource(agent); expect(forget).toHaveBeenCalledWith('Agent', 'saved');
  await deleteWorkspaceResource(agent); forget.mockRestore();
});

it('deletes active conversations without creating replacement members during a group batch', async () => {
  useChatStore.setState({ activeConversationId: 'c', conversations: [{ id: 'c', title: 'C', createdAt: 1, updatedAt: 1, environment: null }] });
  await deleteWorkspaceResource(chat);
  expect(useChatStore.getState().activeConversationId).toBe(''); expect(useChatStore.getState().conversations).toEqual([]);
});

it('serializes references for legacy terminal owners and every content source without leaking messages', () => {
  expect(workspaceHistoryMember(term)).toMatchObject({ empty: true, paneCount: 1 });
  expect(workspaceHistoryMember(agent)).toBeNull();
  useChatStore.setState({ conversations: [{ id: 'c', title: 'C', createdAt: 1, updatedAt: 1, environment: { kind: 'ssh', cwd: '/remote', paneId: 'ssh', label: 'Host' } }] });
  expect(workspaceHistoryMember(chat)).toMatchObject({ ssh: true });
  expect(workspaceHistoryMember({ ...chat, sessionId: 'missing' })).toMatchObject({ empty: true });
  const comparison: WorkspaceResource = { id: 'diff:d', title: 'Diff', kind: 'comparison', comparisonId: 'd' };
  expect(workspaceHistoryMember(comparison)).toBeNull();
  useWorkspaceStore.setState({ tabs: [{ id: 'd', title: 'Diff', kind: 'git-diff', selection: { target: { cwd: '/work', connectionId: 'ssh' }, path: 'a', scope: 'staged', paneId: '' } }] });
  expect(workspaceHistoryMember(comparison)).toMatchObject({ scope: 'staged', ssh: true });
  const missing: WorkspaceResource = { ...comparison, comparisonId: 'missing' };
  expect(workspaceHistoryMember(missing)).toBeNull();
  const pair: WorkspaceHistorySnapshot['layout'] = { type: 'split', direction: 'row', ratio: 0.5, first: snapshot().layout, second: { type: 'pane', id: 'b', resourceId: agent.id } };
  expect(captureWorkspaceHistory(pair, 'a', [doc, agent])).toBeNull();
  expect(captureWorkspaceHistory(pair, 'a', [doc])).toBeNull();
  useHarnessWorkspace.setState({ connections: [{ id: 'a', harness: 'Agent', cwd: '', fresh: false }] });
  useHarnessStore.setState({ byTab: { a: { harness: 'Agent', messages: [{ id: 'q', role: 'user', content: 'Question', createdAt: 1 }] } as unknown as HarnessSession } });
  expect(workspaceHistoryMember(agent)).toMatchObject({ remoteId: undefined });
  useHarnessStore.setState({ byTab: { a: { harness: 'Agent', sessionId: 'live', messages: [{ id: 'q', role: 'user', content: 'Question', createdAt: 1 }] } as unknown as HarnessSession } });
  expect(workspaceHistoryMember(agent)).toMatchObject({ remoteId: 'live' });
  expect(captureWorkspaceHistory(pair, 'missing', [doc, agent])?.focused).toBe('a');
});

it('counts legacy terminal content by owner and keeps starter panes out of history', () => {
  const owner = { ...term, paneId: undefined };
  useBlockStore.setState({ byTab: { unrelated: [], s: [], 's#2': [{ id: 'b', command: '', outputText: '', outputRaw: 'raw' } as import('@features/terminal/services/pipeline/termBlock').TermBlock] } });
  expect(workspaceHistoryMember(owner)?.empty).toBeUndefined();
  useBlockStore.setState({ byTab: { 's#0': [{ id: 'b', command: 'pwd', outputText: '', outputRaw: '' } as import('@features/terminal/services/pipeline/termBlock').TermBlock] } });
  expect(workspaceHistoryMember(term)?.empty).toBeUndefined();
  expect(captureWorkspaceHistory(null, '', [])).toBeNull();
  expect(captureWorkspaceHistory(snapshot().layout, 'a', [])).toBeNull();
  expect(captureWorkspaceHistory(snapshot().layout, 'a', [], true)).toBeNull();
  useWorkspaceStore.setState({ tabs: [{ id: 's', title: 'Shell', kind: 'session', layout: leaf({ id: 's#0', kind: 'local' }) }] });
  expect(workspaceHistoryMember(owner)?.local).toBe(true);
  useBlockStore.setState({ byTab: { s: [{ id: 'b', command: 'pwd', outputText: '', outputRaw: '' } as import('@features/terminal/services/pipeline/termBlock').TermBlock] } });
  expect(workspaceHistoryMember(owner)?.empty).toBeUndefined();
  useBlockStore.setState({ byTab: { s: [{ id: 'b', command: '', outputText: 'output', outputRaw: '' } as import('@features/terminal/services/pipeline/termBlock').TermBlock] } });
  expect(workspaceHistoryMember(owner)?.empty).toBeUndefined();
});

it('checks queued suppression against each immutable request identity', async () => {
  const writer = createWorkspaceHistoryWriter(vi.fn());
  const first = writer(historySnapshot(), { id: 'workspace:queued-a', createdAt: 1 });
  const second = writer(historySnapshot(), { id: 'workspace:queued-b', createdAt: 1 });
  suppressWorkspaceHistory('workspace:queued-a'); await Promise.all([first, second]);
  expect(vi.mocked(saveWorkspaceHistory).mock.calls.map(([request]) => request.id)).toEqual(['workspace:queued-b']);
  clearWorkspaceHistorySuppression('workspace:queued-a'); await writer(null);
});

it('serializes concurrent saves, suppresses pending writes during deletion and recovers after storage failures', async () => {
  const tab = { ...container('edge'), historyIdentity: { id: 'workspace:edge', createdAt: 1 } }; const value = historySnapshot();
  useWorkbenchStore.getState().update(state => ({ ...state, tabs: [tab] }));
  let finish!: () => void;
  vi.mocked(saveWorkspaceHistory).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const pending = persistContainerHistory(tab, value);
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  suppressWorkspaceHistory('workspace:edge'); expect(persistContainerHistory(tab, value)).toBe(pending);
  finish(); await pending; expect(sessionSetGroup).not.toHaveBeenCalled();
  await persistContainerHistory(container('edge'), value);
  releaseContainerHistory('edge', true); const current = useWorkbenchStore.getState().snapshot.tabs[0]!;
  vi.mocked(saveWorkspaceHistory).mockRejectedValueOnce(new Error('offline'));
  const failed = persistContainerHistory(current, value); const recovered = persistContainerHistory(current, value);
  await expect(failed).rejects.toThrow('offline'); await recovered;
  await settleContainerHistory(['edge', 'missing']);
  expect(sessionSetGroup).toHaveBeenCalledWith('workspace:edge', null);
  await persistContainerHistory({ ...tab, scope: 'terminal' }, value); await persistContainerHistory(tab, null);
});

it('serializes one history identity across a close and restoration into a different live container', async () => {
  const identity = { id: 'workspace:transferred-queue', createdAt: 1 };
  const first = { ...container('before-restore'), historyIdentity: identity };
  const next = { ...container('after-restore'), historyIdentity: identity, title: 'Latest restored title' };
  let finish!: () => void;
  vi.mocked(saveWorkspaceHistory).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const pending = persistContainerHistory(first, historySnapshot());
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  const restored = persistContainerHistory(next, historySnapshot());
  await Promise.resolve(); await Promise.resolve(); expect(saveWorkspaceHistory).toHaveBeenCalledOnce();
  finish(); await Promise.all([pending, restored]);
  expect(vi.mocked(saveWorkspaceHistory).mock.calls.map(([request]) => [request.id, request.title])).toEqual([[identity.id, 'C'], [identity.id, next.title]]);
});

it('retains a closed save identity when the same container identifier is reused', async () => {
  const old = { ...container('reused-owner'), historyIdentity: { id: 'workspace:old-owner', createdAt: 1 } };
  const next = { ...old, historyIdentity: { id: 'workspace:new-owner', createdAt: 2 } };
  useWorkbenchStore.getState().update(state => ({ ...state, tabs: [next] }));
  await persistContainerHistory(old, historySnapshot());
  expect(vi.mocked(saveWorkspaceHistory).mock.calls[0]![0].id).toBe(old.historyIdentity.id);
  expect(useWorkbenchStore.getState().snapshot.tabs[0]!.historyIdentity).toEqual(next.historyIdentity);
});
