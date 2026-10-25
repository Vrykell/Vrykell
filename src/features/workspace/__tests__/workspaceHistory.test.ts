import { beforeEach, expect, it, vi } from 'vitest';
import { captureWorkspaceHistory, createWorkspaceHistoryWriter } from '../services/workspaceHistory';
import { parseWorkspaceHistory, remapWorkspaceHistory, type WorkspaceHistorySnapshot } from '../model/workspaceHistory';
import { restoreWorkspaceComposition, restoreWorkspaceMember } from '../services/restoreWorkspaceHistory';
import { useWorkspaceStore } from '../stores/workspace';
import { useUnifiedWorkspace } from '../stores/unifiedWorkspace';
import { useWorkspaceNavigation } from '../stores/navigation';
import { useChatStore } from '@features/chat/stores/chat';
import { useAiWorkspace } from '@features/chat/stores/aiWorkspace';
import { useHarnessWorkspace } from '@features/chat/stores/harnessWorkspace';
import { currentWorkspaceResources } from '../services/workspaceResources';
import { leaf } from '../model/windowLayout';
import { saveWorkspaceHistory } from '@platform/api/historyPage';
import { getSession } from '@platform/api/session';
import { useBlockStore } from '@features/terminal/stores/blocks';
import { useHarnessStore } from '@features/chat/stores/harness';

vi.mock('@platform/diagnostics', () => ({ invoke: vi.fn(async () => undefined), diagnostic: vi.fn() }));
vi.mock('@platform/api/historyPage', () => ({ saveWorkspaceHistory: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@platform/api/session', async () => ({ ...await vi.importActual<typeof import('@platform/api/session')>('@platform/api/session'), getSession: vi.fn() }));
vi.mock('@platform/api/conversation', async () => ({ ...await vi.importActual<typeof import('@platform/api/conversation')>('@platform/api/conversation'), listConversationMessages: vi.fn().mockResolvedValue([]) }));

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
  useUnifiedWorkspace.setState({ layout: null, focused: '', historyIdentity: undefined, startActive: true });
  useWorkspaceNavigation.setState({ area: 'history', historyDestination: 'unified' });
  useBlockStore.setState({ byTab: {} });
  vi.mocked(saveWorkspaceHistory).mockResolvedValue(undefined);
});

it('validates reference-only layouts and rejects duplicate or missing members', () => {
  expect(parseWorkspaceHistory(JSON.stringify(snapshot()))).toEqual(snapshot());
  for (const change of ['duplicate', 'missing', 'focus', 'kind', 'large']) {
    const value = snapshot();
    if (change === 'duplicate') value.members[1]!.id = value.members[0]!.id;
    if (change === 'missing') value.members.pop();
    if (change === 'focus') value.focused = 'absent';
    if (change === 'kind') Object.assign(value.members[0]!, { kind: 'unknown' });
    if (change === 'large') value.members[0]!.reference = 'x'.repeat(8193);
    expect(parseWorkspaceHistory(JSON.stringify(value))).toBeNull();
  }
  expect(() => remapWorkspaceHistory(snapshot(), new Map([['terminal:one#0', 'same'], ['chat:two', 'same']]))).toThrow();
});

it('restores empty pane templates without creating empty history records or reviving a saved conversation', async () => {
  useWorkspaceStore.setState({ tabs: [], activeId: '' });
  useChatStore.setState({ conversations: [], byTab: {} });
  const terminal = await restoreWorkspaceMember({ ...snapshot().members[0]!, empty: true, shellType: 'bash' });
  expect(terminal).toMatch(/^terminal:/);
  expect(getSession).not.toHaveBeenCalled();
  const conversation = await restoreWorkspaceMember({ ...snapshot().members[1]!, empty: true });
  expect(conversation).not.toBe('chat:two');
  expect(useChatStore.getState().byTab[conversation.slice(5)]).toEqual([]);
  expect(useChatStore.getState().conversations.find(item => item.id === conversation.slice(5))?.title).toBe('Chat');
  const invalid = snapshot(); invalid.members[0]!.empty = true;
  expect(parseWorkspaceHistory(JSON.stringify(invalid))?.members[0]?.empty).toBe(true);
  expect(parseWorkspaceHistory(JSON.stringify({ ...invalid, members: [{ ...invalid.members[0], empty: 'invalid' }, invalid.members[1]] }))).toBeNull();
});

it('stores durable external history identities rather than live process identifiers', () => {
  useHarnessWorkspace.setState({ connections: [{ id: 'agent', harness: 'Agent', cwd: '/project', fresh: false }] });
  useHarnessStore.setState({ byTab: { agent: { harness: 'Agent', sessionId: 'live', resumeSessionId: 'durable', messages: [{ id: 'q', role: 'user', content: 'Question', createdAt: 1 }] } as import('@features/chat/stores/harness').HarnessSession } });
  const record = captureWorkspaceHistory({ type: 'split', direction: 'row', ratio: 0.5,
    first: { type: 'pane', id: 'a', resourceId: 'acp:agent' }, second: { type: 'pane', id: 'b', resourceId: 'file:test' } }, 'a', [
    { id: 'acp:agent', title: 'Agent', kind: 'agent', sessionId: 'agent' },
    { id: 'file:test', title: 'test', kind: 'document', file: { path: '/test' } },
  ]);
  expect(record?.members[0]).toMatchObject({ remoteId: 'durable' });
  expect(record?.members[0]?.empty).toBeUndefined();
});

it('updates one combination record rather than producing a record per resize or effect replay', async () => {
  const writer = createWorkspaceHistoryWriter(vi.fn());
  await writer(snapshot()); await writer(snapshot());
  expect(saveWorkspaceHistory).toHaveBeenCalledOnce();
  const changed = snapshot();
  if (changed.layout.type === 'split') changed.layout.ratio = 0.7;
  await writer(changed);
  expect(saveWorkspaceHistory).toHaveBeenCalledTimes(2);
  expect(vi.mocked(saveWorkspaceHistory).mock.calls[1]![0].id).toBe(vi.mocked(saveWorkspaceHistory).mock.calls[0]![0].id);
  await writer(snapshot(), { id: 'workspace:restored', createdAt: 5 });
  expect(saveWorkspaceHistory).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'workspace:restored', createdAt: 5 }));
});

it('can retry a failed save without losing the original error or capturing message content', async () => {
  const error = vi.fn();
  const writer = createWorkspaceHistoryWriter(error);
  vi.mocked(saveWorkspaceHistory).mockRejectedValueOnce(new Error('Offline'));
  await writer(snapshot()); await writer(snapshot());
  expect(error).toHaveBeenCalledOnce();
  expect(saveWorkspaceHistory).toHaveBeenCalledTimes(2);
  expect(vi.mocked(saveWorkspaceHistory).mock.calls[1]![0].payload).not.toMatch(/messages|password|apiKey/);
});

it('keeps one tab history identity when its membership changes', async () => {
  const writer = createWorkspaceHistoryWriter(vi.fn());
  const identity = { id: 'workspace:tab', createdAt: 1 };
  await writer(snapshot(), identity);
  const changed = snapshot();
  changed.members[1] = { ...changed.members[1]!, id: 'chat:other', reference: 'other' };
  if (changed.layout.type === 'split' && changed.layout.second.type === 'pane') changed.layout.second.resourceId = 'chat:other';
  await writer(changed, identity);
  expect(vi.mocked(saveWorkspaceHistory).mock.calls.map(([request]) => request.id)).toEqual(['workspace:tab', 'workspace:tab']);
});

it('republishes a cleared history identity without duplicating its saved record', async () => {
  const identity = vi.fn();
  const writer = createWorkspaceHistoryWriter(vi.fn(), identity);
  await writer(snapshot());
  const original = identity.mock.calls[0]![0];
  identity.mockClear();
  await writer(snapshot());
  expect(identity).toHaveBeenLastCalledWith(original);
  expect(saveWorkspaceHistory).toHaveBeenCalledOnce();
});

it('restores members through their owners and commits the layout without cloning the existing terminal', async () => {
  await restoreWorkspaceComposition(snapshot(), { id: 'workspace:saved', createdAt: 1 });
  expect(useWorkspaceStore.getState().tabs.filter(tab => tab.kind === 'session')).toHaveLength(1);
  expect(useAiWorkspace.getState().nativeTabs).toContain('two');
  expect(useUnifiedWorkspace.getState()).toMatchObject({ layout: snapshot().layout, focused: 'first', historyIdentity: { id: 'workspace:saved', createdAt: 1 } });
  expect(useWorkspaceNavigation.getState().area).toBe('unified');
  const captured = captureWorkspaceHistory(snapshot().layout, 'first', currentWorkspaceResources());
  expect(captured).toBeNull();
  useChatStore.setState({ byTab: { two: [{ id: 'q', role: 'user', content: 'First input', createdAt: 1 }] } });
  expect(captureWorkspaceHistory(snapshot().layout, 'first', currentWorkspaceResources())?.members.map(member => member.kind)).toEqual(['terminal', 'conversation']);
});

it('leaves the current layout intact when a member cannot be restored', async () => {
  const existing = { type: 'pane' as const, id: 'existing', resourceId: 'terminal:one' };
  useUnifiedWorkspace.setState({ layout: existing });
  const value = snapshot(); value.members[0]!.id = 'terminal:missing'; value.members[0]!.reference = 'missing';
  if (value.layout.type === 'split' && value.layout.first.type === 'pane') value.layout.first.resourceId = 'terminal:missing';
  vi.mocked(getSession).mockRejectedValueOnce(new Error('Missing'));
  await expect(restoreWorkspaceComposition(value)).rejects.toThrow('Missing');
  expect(useUnifiedWorkspace.getState().layout).toBe(existing);
});

it('keeps an explicit external-session reference isolated from the most recent agent session', async () => {
  const id = await restoreWorkspaceMember({ id: 'acp:old', title: 'Agent', kind: 'agent', reference: 'Agent', remoteId: 'specific-session', cwd: '/work', paneCount: 1, local: true, ssh: false });
  expect(useHarnessWorkspace.getState().connections.find(connection => `acp:${connection.id}` === id)).toMatchObject({ harness: 'Agent', cwd: '/work', resumeSessionId: 'specific-session', fresh: false });
});
