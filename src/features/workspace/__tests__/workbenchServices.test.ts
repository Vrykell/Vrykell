import { beforeEach, expect, it, vi } from 'vitest';
import { editorFileKey, interceptEditorClose } from '@core/editor';
import { interceptHarnessClose } from '@core/harness';
import { useAiWorkspace } from '@features/chat/stores/aiWorkspace';
import { useChatStore } from '@features/chat/stores/chat';
import { useHarnessWorkspace } from '@features/chat/stores/harnessWorkspace';
import { useHarnessStore } from '@features/chat/stores/harness';
import { useBlockStore } from '@features/terminal/stores/blocks';
import { useTerminalStore } from '@features/terminal/stores/terminal';
import * as groupApi from '@platform/api/group';
import { deleteSession } from '@platform/api/session';
import { saveWorkspaceHistory } from '@platform/api/historyPage';
import { emptyWorkbench, putContainer, type WorkspaceContainer } from '../model/workbench';
import { leaf, splitLeaf } from '../model/windowLayout';
import { useWorkspaceStore } from '../stores/workspace';
import { useWorkbenchStore } from '../stores/workbench';
import { workspaceAreaStores } from '../stores/paneWorkspace';
import { useWorkspaceNavigation } from '../stores/navigation';
import { activateContainer, assignWorkspaceGroup, closeContainer, createContainerGroup, detachWorkspacePane, focusNativeContainerResource, mergeWorkspaceContainers, persistWorkspaceOrder, removeContainerPane, removeWorkspaceGroup, renameContainer, requestCloseContainers, restoreWorkbench, startWorkbenchRuntime, synchronizeWorkbench, terminalLayoutFromContainer, undoCloseContainer, updateWorkspaceGroup, zoomWorkspaceContainer } from '../services/workbench';
import { panesOf } from '../model/workbench';
import * as restoreService from '../services/restoreWorkspaceHistory';
import * as sessionManager from '../services/sessionManager';
import { useWorkbenchFeedback } from '../stores/workbenchFeedback';
import { useUiStore } from '../stores/ui';
import { parseWorkbench } from '../model/workbench';
import { captureContainerHistory, persistContainerHistory } from '../services/workspaceHistory';

vi.mock('@platform/diagnostics', () => ({ invoke: vi.fn(async () => undefined), diagnostic: vi.fn() }));
vi.mock('@platform/api/group', () => ({ groupsList: vi.fn(async () => []), groupCreate: vi.fn(async () => {}), groupRename: vi.fn(async () => {}), groupSetCollapsed: vi.fn(async () => {}), groupDelete: vi.fn(async () => {}), groupDeleteWithSessions: vi.fn(async () => {}), groupsReorder: vi.fn(async () => {}), sessionSetGroup: vi.fn(async () => {}), sessionsReorder: vi.fn(async () => {}), groupRestore: vi.fn(async () => {}), groupArchive: vi.fn(async () => {}) }));
vi.mock('@platform/api/historyPage', () => ({ saveWorkspaceHistory: vi.fn(async () => {}) }));
vi.mock('@platform/api/session', async original => ({ ...await original<typeof import('@platform/api/session')>(), deleteSession: vi.fn(async () => {}) }));
vi.mock('@core/editor', async original => ({ ...await original<typeof import('@core/editor')>(), interceptEditorClose: vi.fn(() => false) }));
vi.mock('@core/harness', () => ({ interceptHarnessClose: vi.fn(() => false), registerHarnessCloseGuard: vi.fn() }));

const workspaceInitial = useWorkspaceStore.getState();
const chatInitial = useChatStore.getState();
const aiInitial = useAiWorkspace.getState();
const agentsInitial = useHarnessWorkspace.getState();
const file = { path: '/repo/a.ts' };
const fileId = `file:${editorFileKey(file)}`;
function document() { useWorkspaceStore.getState().openEditorFile(file); return fileId; }
function conversation(id = 'chat-one') {
  useChatStore.setState(state => ({ conversations: [...state.conversations, { id, title: id, createdAt: 1, updatedAt: 2, environment: null }] }));
  useAiWorkspace.setState(state => ({ nativeTabs: [...state.nativeTabs, id], selected: `chat:${id}` })); return `chat:${id}`;
}
function terminal(id = 'native') {
  useWorkspaceStore.setState(state => ({ tabs: [...state.tabs, { id, title: id, kind: 'session', layout: leaf({ id: `${id}#0`, kind: 'local' }) }], activeId: id })); return `terminal:${id}#0`;
}
function mixed(...ids: string[]) {
  const store = workspaceAreaStores.unified;
  store.getState().show(ids[0]!); for (const id of ids.slice(1)) store.getState().split(id, 'row');
  return store.getState().activeTabId;
}
function current(id: string) { return useWorkbenchStore.getState().snapshot.tabs.find(tab => tab.id === id)!; }
function group(id: string, scope: WorkspaceContainer['scope'], tabIds: string[] = []) {
  useWorkbenchStore.getState().update(state => ({ ...state, groups: [...state.groups, { id, scope, title: 'Project', collapsed: false }], tabs: state.tabs.map(tab => tabIds.includes(tab.id) ? { ...tab, groupId: id } : tab) }));
}

beforeEach(() => {
  vi.clearAllMocks(); vi.mocked(interceptEditorClose).mockReturnValue(false); vi.mocked(interceptHarnessClose).mockReturnValue(false);
  useWorkspaceStore.setState({ ...workspaceInitial, tabs: [], activeId: '', groups: [] }, true);
  useChatStore.setState({ ...chatInitial, conversations: [], byTab: {}, conversationsLoaded: true }, true);
  useAiWorkspace.setState({ ...aiInitial, nativeTabs: [], selected: '', sideSessions: [], sideSelected: '' }, true);
  useHarnessWorkspace.setState({ ...agentsInitial, connections: [], selected: '' }, true);
  useHarnessStore.setState({ byTab: {} }); useBlockStore.setState({ byTab: {} });
  useWorkspaceNavigation.setState({ area: 'code' });
  useTerminalStore.setState({ sessions: {}, focusedPaneId: null });
  useUiStore.setState({ settingsOpen: false });
  useWorkbenchFeedback.setState({ failure: null });
});

it('adopts every native resource once, retains multi-pane terminal containers and prunes closed owners', () => {
  document(); const chat = conversation(); terminal();
  useHarnessWorkspace.setState({ connections: [{ id: 'agent', harness: 'agent', cwd: '/repo', fresh: true }] });
  useAiWorkspace.setState({ sideSessions: [chat], sideSelected: chat });
  const native = useWorkspaceStore.getState().tabs.find(tab => tab.kind === 'session')!;
  if (native.kind !== 'session') throw new Error('Expected terminal');
  useWorkspaceStore.getState().setWindowLayout(native.id, splitLeaf(native.layout, 'native#0', 'row', 'second', { id: 'native#1', kind: 'ssh', ssh: { name: 'Host', host: 'host' } }));
  useTerminalStore.setState({ focusedPaneId: 'native#1' });
  synchronizeWorkbench();
  const state = useWorkbenchStore.getState().snapshot;
  expect(state.tabs.filter(tab => tab.scope === 'terminal')).toHaveLength(1);
  expect(current('native').focused).toBe('native#1'); expect(panesOf(current('native'))).toHaveLength(2);
  expect(state.tabs.some(tab => tab.id === chat)).toBe(false);
  expect(state.tabs.some(tab => tab.id === 'acp:agent')).toBe(true);
  synchronizeWorkbench(); expect(useWorkbenchStore.getState().snapshot).toBe(state);
  useTerminalStore.setState({ focusedPaneId: 'gone' }); synchronizeWorkbench(); expect(current('native').focused).toBe('native#1');
  useWorkbenchStore.getState().update(state => putContainer(state, { ...current('native'), zoomed: 'native#1' }));
  synchronizeWorkbench(); expect(current('native').zoomed).toBe('native#1');
  useWorkspaceStore.setState({ tabs: [] }); synchronizeWorkbench(); expect(useWorkbenchStore.getState().snapshot.tabs.some(tab => tab.scope === 'terminal')).toBe(false);
  useWorkbenchStore.setState({ ready: false }); document(); synchronizeWorkbench(); useWorkspaceStore.setState({ tabs: [] }); synchronizeWorkbench();
  expect(useWorkbenchStore.getState().snapshot.tabs.some(tab => tab.scope === 'code')).toBe(true);
});

it('follows native terminal insertion order after a grouped restore', () => {
  terminal('two'); terminal('one'); synchronizeWorkbench();
  expect(useWorkbenchStore.getState().snapshot.tabs.filter(tab => tab.scope === 'terminal').map(tab => tab.id)).toEqual(['two', 'one']);
  document();
  terminal('three'); synchronizeWorkbench();
  expect(useWorkbenchStore.getState().snapshot.tabs.filter(tab => tab.scope === 'terminal').map(tab => tab.id)).toEqual(['two', 'one', 'three']);
  expect(useWorkbenchStore.getState().snapshot.tabs.some(tab => tab.scope === 'code')).toBe(true);
  useWorkbenchStore.getState().update(state => putContainer(state, { id: 'orphan', scope: 'terminal', layout: { type: 'pane', id: 'orphan-pane', resourceId: 'terminal:one#0' }, focused: 'orphan-pane', zoomed: null }));
  useWorkspaceStore.setState(state => ({ tabs: [...state.tabs, { id: 'four', title: 'four', kind: 'session', layout: leaf({ id: 'four#0', kind: 'local' }) }] }));
  synchronizeWorkbench();
  const terminals = useWorkbenchStore.getState().snapshot.tabs.filter(tab => tab.scope === 'terminal');
  expect(terminals[terminals.length - 1]?.id).toBe('orphan');
});

it('activates layout containers through native owners and ignores missing tabs and resources', () => {
  const id = document(); const chat = conversation(); synchronizeWorkbench();
  const selected = mixed(id, chat);
  activateContainer(selected); expect(useWorkspaceNavigation.getState().area).toBe('unified');
  expect(useWorkbenchStore.getState().snapshot.selected.unified).toBe(selected);
  activateContainer('missing');
  focusNativeContainerResource(id); expect(useWorkbenchStore.getState().snapshot.selected.code).toBe(id);
  focusNativeContainerResource('missing');
  renameContainer(selected, 'Mixed'); expect(current(selected).title).toBe('Mixed');
  const code = current(id); renameContainer(id, '  Project  '); expect(current(id).title).toBe('Project');
  renameContainer(id, ' '); renameContainer('missing', 'Other'); expect(current(id).layout).toBe(code.layout);
  terminal(); synchronizeWorkbench(); renameContainer('native', 'Renamed'); expect(useWorkspaceStore.getState().tabs.find(tab => tab.id === 'native')!.title).toBe('Renamed');
  renameContainer(chat, 'Named conversation'); expect(useChatStore.getState().conversations.find(item => item.id === 'chat-one')!.title).toBe('Named conversation');
  workspaceAreaStores.unified.getState().openStart();
  useWorkbenchStore.getState().update(state => putContainer(state, { id: 'empty', scope: 'unified', layout: null, focused: '', zoomed: null }));
  activateContainer('empty'); expect(useWorkbenchStore.getState().snapshot.selected.unified).toBe('empty');
  useWorkbenchStore.getState().update(state => ({ ...state, tabs: state.tabs.map(tab => tab.id === selected ? { ...tab, focused: 'missing' } : tab) }));
  activateContainer(selected); expect(useWorkspaceNavigation.getState().area).toBe('unified');
});

it('follows native terminal activation even when the focused pane does not change', () => {
  const stop = startWorkbenchRuntime();
  terminal('one'); terminal('two'); synchronizeWorkbench();
  useTerminalStore.setState({ focusedPaneId: 'two#0' });
  useWorkspaceStore.setState({ activeId: 'one' });
  expect(useWorkbenchStore.getState().snapshot.selected.terminal).toBe('one');
  useWorkspaceStore.getState().activate('two');
  expect(useWorkbenchStore.getState().snapshot.selected.terminal).toBe('two');
  stop();
});

it('checks all dirty documents and agents before closing any member and honors forced closure', () => {
  const id = document(); const chat = conversation();
  useHarnessWorkspace.setState({ connections: [{ id: 'agent', harness: 'agent', cwd: '/repo', fresh: true }] });
  const container = mixed(id, chat, 'acp:agent');
  const complete = vi.fn(); requestCloseContainers(['missing'], complete); expect(complete).not.toHaveBeenCalled();
  let editorDone: (() => void) | undefined; let agentDone: (() => void) | undefined;
  vi.mocked(interceptEditorClose).mockImplementation((_files, done) => { editorDone = done; return true; });
  vi.mocked(interceptHarnessClose).mockImplementation((_ids, done) => { agentDone = done; return true; });
  requestCloseContainers([container], complete);
  expect(interceptEditorClose).toHaveBeenCalledWith([file], expect.any(Function)); expect(interceptHarnessClose).not.toHaveBeenCalled();
  editorDone!(); expect(interceptHarnessClose).toHaveBeenCalledWith(['agent'], expect.any(Function)); expect(complete).not.toHaveBeenCalled();
  agentDone!(); expect(complete).toHaveBeenCalledOnce();
  requestCloseContainers([container], complete, true); expect(complete).toHaveBeenCalledTimes(2);
});

it('closes a complete tab, retains its undo snapshot and selects a surviving neighbor', () => {
  const id = document(); const chat = conversation(); const first = mixed(id, chat);
  workspaceAreaStores.unified.getState().show(terminal('other')); const second = workspaceAreaStores.unified.getState().activeTabId;
  closeContainer(first); expect(useWorkbenchStore.getState().lastClosed).toMatchObject({ scope: 'unified', restoreSnapshot: { members: expect.any(Array) } });
  expect(useWorkbenchStore.getState().snapshot.selected.unified).toBe(second);
  closeContainer(second); expect(workspaceAreaStores.unified.getState().startActive).toBe(true);
  expect(useWorkspaceStore.getState().tabs.some(tab => tab.kind === 'editor')).toBe(false);
});

it('does not discard native resources until a guarded group close completes', async () => {
  document(); synchronizeWorkbench(); group('group', 'code', [fileId]);
  let finish: (() => void) | undefined;
  vi.mocked(interceptEditorClose).mockImplementation((_files, done) => { finish = done; return true; });
  const error = vi.fn(); removeWorkspaceGroup('group', 'delete', error);
  expect(groupApi.groupDeleteWithSessions).not.toHaveBeenCalled(); expect(current(fileId)).toBeTruthy();
  finish!(); await vi.waitFor(() => expect(useWorkbenchStore.getState().snapshot.groups).toHaveLength(0));
  expect(groupApi.groupDeleteWithSessions).toHaveBeenCalledWith('group'); expect(error).not.toHaveBeenCalled();
});

it('creates, assigns, renames and collapses groups using one persisted protocol', async () => {
  document(); synchronizeWorkbench();
  expect(await createContainerGroup('missing')).toBe('');
  workspaceAreaStores.code.getState().openStart();
  useWorkbenchStore.getState().update(state => putContainer(state, { id: 'empty', scope: 'code', layout: null, focused: '', zoomed: null }));
  expect(await createContainerGroup('empty')).toBe('');
  const id = await createContainerGroup(fileId); expect(id).toMatch(/^group:code:/); expect(current(fileId).groupId).toBe(id);
  expect(groupApi.groupCreate).toHaveBeenCalledWith(id, expect.any(String), expect.any(Number));
  await updateWorkspaceGroup(id, { title: 'Renamed', collapsed: true }); expect(useWorkbenchStore.getState().snapshot.groups[0]).toMatchObject({ title: 'Renamed', collapsed: true });
  await updateWorkspaceGroup(id, {}); await updateWorkspaceGroup('missing', { title: 'Unknown' });
  useWorkbenchStore.getState().update(state => putContainer(state, { ...current(fileId), historyIdentity: { id: 'workspace:one', createdAt: 1 } }));
  await assignWorkspaceGroup(fileId); expect(current(fileId).groupId).toBeUndefined(); expect(groupApi.sessionSetGroup).toHaveBeenCalledWith('workspace:one', null);
  await assignWorkspaceGroup(fileId, id); expect(current(fileId).groupId).toBe(id);
  await assignWorkspaceGroup('missing', id);
  activateContainer(fileId); await vi.waitFor(() => expect(useWorkbenchStore.getState().snapshot.groups[0]!.collapsed).toBe(false));
});

it('adapts terminal groups, naming and focus without introducing another group store', async () => {
  terminal(); synchronizeWorkbench();
  const created = await createContainerGroup('native', 'Terminals');
  expect(created).toMatch(/^group:terminal:/); expect(groupApi.groupCreate).toHaveBeenCalledWith(created, 'Terminals', expect.any(Number));
  useWorkspaceStore.setState({ groups: [{ id: 'g', title: 'Terminals', collapsed: true }], tabs: useWorkspaceStore.getState().tabs.map(tab => tab.kind === 'session' ? { ...tab, groupId: 'g' } : tab) });
  synchronizeWorkbench(); activateContainer('native'); await vi.waitFor(() => expect(useWorkspaceStore.getState().groups[0]!.collapsed).toBe(false));
  await updateWorkspaceGroup('g', { title: 'Shells', collapsed: true }); expect(useWorkspaceStore.getState().groups[0]).toMatchObject({ title: 'Shells', collapsed: true });
  await assignWorkspaceGroup('native'); expect(current('native').groupId).toBeUndefined();
  await assignWorkspaceGroup('native', 'g'); expect(current('native').groupId).toBe('g');
});

it('archives every member with its original group and keeps a failed batch reviewable', async () => {
  document(); const chat = conversation(); const id = mixed(fileId, chat); group('g', 'unified', [id]);
  const error = vi.fn();
  vi.mocked(groupApi.groupArchive).mockRejectedValueOnce(new Error('offline'));
  removeWorkspaceGroup('g', 'archive', error); await vi.waitFor(() => expect(error).toHaveBeenCalled());
  expect(current(id)).toBeTruthy(); expect(useWorkbenchStore.getState().snapshot.groups).toHaveLength(1);
  removeWorkspaceGroup('g', 'archive', error); await vi.waitFor(() => expect(useWorkbenchStore.getState().snapshot.groups).toHaveLength(0));
  expect(saveWorkspaceHistory).toHaveBeenCalled(); expect(groupApi.sessionSetGroup).toHaveBeenCalledWith(expect.stringMatching(/^workspace:/), 'g');
  expect(useAiWorkspace.getState().nativeTabs).toHaveLength(0);
  removeWorkspaceGroup('missing', 'delete', error);
  group('empty', 'code'); removeWorkspaceGroup('empty', 'archive', error); await vi.waitFor(() => expect(useWorkbenchStore.getState().snapshot.groups).toHaveLength(0));
});

it('deletes terminal and conversation members and their history instead of merely ungrouping them', async () => {
  const chat = conversation(); const term = terminal(); const id = mixed(chat, term); group('g', 'unified', [id]);
  useWorkbenchStore.getState().update(state => putContainer(state, { ...current(id), historyIdentity: { id: 'workspace:delete', createdAt: 1 } }));
  const error = vi.fn(); removeWorkspaceGroup('g', 'delete', error);
  await vi.waitFor(() => expect(useWorkbenchStore.getState().snapshot.groups).toHaveLength(0));
  expect(deleteSession).toHaveBeenCalledWith('native'); expect(useChatStore.getState().conversations).toHaveLength(0); expect(error).not.toHaveBeenCalled();
  terminal('second'); synchronizeWorkbench(); useWorkspaceStore.setState({ groups: [{ id: 'native-group', title: 'Terminals', collapsed: false }], tabs: useWorkspaceStore.getState().tabs.map(tab => tab.kind === 'session' ? { ...tab, groupId: 'native-group' } : tab) });
  synchronizeWorkbench(); removeWorkspaceGroup('native-group', 'archive', error);
  await vi.waitFor(() => expect(useWorkspaceStore.getState().groups).toHaveLength(0));
});

it('detaches every scope with stable pane ownership and ignores absent panes', () => {
  const first = document(); const secondFile = { path: '/repo/b.ts' }; useWorkspaceStore.getState().openEditorFile(secondFile); synchronizeWorkbench();
  const store = workspaceAreaStores.code; store.getState().show(first); store.getState().split(`file:${editorFileKey(secondFile)}`, 'row');
  detachWorkspacePane('code', first); expect(panesOf(current(useWorkbenchStore.getState().snapshot.selected.code!))).toHaveLength(1);
  detachWorkspacePane('code', 'missing'); detachWorkspacePane('terminal', 'missing');
  terminal(); const native = useWorkspaceStore.getState().tabs.find(tab => tab.id === 'native');
  if (native?.kind !== 'session') throw new Error('Expected terminal');
  useWorkspaceStore.getState().setWindowLayout('native', splitLeaf(native.layout, 'native#0', 'row', 'second', { id: 'native#1', kind: 'local' }));
  detachWorkspacePane('terminal', 'terminal:native#1'); expect(useWorkspaceStore.getState().tabs.filter(tab => tab.kind === 'session')).toHaveLength(2);
});

it('converts terminal layouts at the persistence boundary and refuses missing resource owners', () => {
  terminal(); synchronizeWorkbench(); const native = current('native'); expect(terminalLayoutFromContainer(native)).toEqual(leaf({ id: 'native#0', kind: 'local' }));
  expect(terminalLayoutFromContainer({ ...native, layout: null })).toBeNull();
  expect(terminalLayoutFromContainer({ ...native, layout: { type: 'pane', id: 'a', resourceId: 'terminal:missing' } })).toBeNull();
  const layout = { type: 'split' as const, direction: 'col' as const, ratio: 0.4, first: { type: 'pane' as const, id: 'a', resourceId: 'terminal:native#0' }, second: { type: 'pane' as const, id: 'b', resourceId: 'terminal:native#0' } };
  expect(terminalLayoutFromContainer({ ...native, layout })).toMatchObject({ type: 'split', dir: 'col', ratio: 0.4 });
  expect(terminalLayoutFromContainer({ ...native, layout: { ...layout, second: { type: 'pane', id: 'b', resourceId: 'missing' } } })).toBeNull();
});

it('binds canonical layouts and native focus for one disposable runtime lifetime', () => {
  terminal(); const stop = startWorkbenchRuntime();
  const native = current('native');
  useWorkbenchStore.getState().update(state => state);
  useWorkbenchStore.setState({ ready: true });
  useWorkbenchStore.getState().update(state => putContainer(state, { ...native, layout: { type: 'split', direction: 'row', ratio: 0.4, first: { type: 'pane', id: 'a', resourceId: 'terminal:native#0' }, second: { type: 'pane', id: 'b', resourceId: 'terminal:native#0' } } }));
  expect(useWorkspaceStore.getState().tabs.find(tab => tab.id === 'native')).toMatchObject({ layout: { type: 'split', ratio: 0.4 } });
  useTerminalStore.setState({ focusedPaneId: 'native#0' }); useTerminalStore.setState({ focusedPaneId: 'missing' }); useTerminalStore.setState({ focusedPaneId: 'missing' });
  useWorkspaceStore.setState({ groups: [] }); conversation(); document();
  expect(useWorkbenchStore.getState().snapshot.tabs.some(tab => tab.scope === 'code')).toBe(true);
  stop(); useWorkbenchStore.setState({ snapshot: emptyWorkbench() }); conversation('after'); expect(useWorkbenchStore.getState().snapshot.tabs).toEqual([]);
});

it('clears all reference snapshots for non-restoring startup and ignores an absent undo entry', async () => {
  await restoreWorkbench('empty', vi.fn());
  document(); synchronizeWorkbench(); await undoCloseContainer();
  useWorkbenchStore.setState({ lastClosed: { ...current(fileId), scope: 'terminal' } }); await undoCloseContainer();
  await restoreWorkbench('empty', vi.fn()); expect(useWorkbenchStore.getState().ready).toBe(true);
  await restoreWorkbench('restore', vi.fn()); expect(useWorkbenchStore.getState().ready).toBe(true);
});

it('restores saved containers by resource identity without removing previously restored peer tabs', async () => {
  document(); useWorkspaceStore.getState().openEditorFile({ path: '/repo/b.ts' }); conversation(); terminal(); synchronizeWorkbench();
  const saved = structuredClone(useWorkbenchStore.getState().snapshot);
  const code = saved.tabs.find(tab => tab.id === fileId)!;
  code.id = 'saved-code'; saved.selected.code = 'saved-code';
  saved.tabs.push({ ...code, id: 'mixed', scope: 'unified' });
  saved.tabs.push({ id: 'without-snapshot', scope: 'ai', layout: null, focused: '', zoomed: null });
  saved.tabs.push({ ...code, id: 'missing-draft', restoreSnapshot: { ...code.restoreSnapshot!, members: [{ ...code.restoreSnapshot!.members[0]!, id: 'file:missing', draftId: 'lost', reference: 'untitled' }], layout: { type: 'pane', id: code.focused, resourceId: 'file:missing' } } });
  const error = vi.fn(); await restoreWorkbench('restore', error, saved);
  expect(error).toHaveBeenCalledOnce();
  expect(useWorkbenchStore.getState().snapshot.tabs.filter(tab => tab.scope === 'code')).toHaveLength(2);
  expect(useWorkbenchStore.getState().snapshot.tabs.some(tab => tab.id === 'mixed')).toBe(true);
  expect(useWorkbenchStore.getState().snapshot.selected.code).toBe(saved.selected.code);
});

it('activates the selected container after restoring later peers with different native selection', async () => {
  const first = conversation('first'); conversation('last'); synchronizeWorkbench();
  const saved = structuredClone(useWorkbenchStore.getState().snapshot); saved.selected.ai = first;
  useWorkspaceNavigation.setState({ area: 'ai' });
  await restoreWorkbench('restore', vi.fn(), saved);
  expect(useWorkbenchStore.getState().snapshot.selected.ai).toBe(first);
  expect(useAiWorkspace.getState().selected).toBe(first);
  useUiStore.setState({ settingsOpen: true }); await restoreWorkbench('restore', vi.fn(), saved);
  expect(useUiStore.getState().settingsOpen).toBe(true);
  useUiStore.setState({ settingsOpen: false });
  useWorkspaceNavigation.setState({ area: 'history' }); await restoreWorkbench('empty', vi.fn());
});

it('restores a closed container with its title and existing group and leaves a failed undo available', async () => {
  document(); synchronizeWorkbench(); group('g', 'code', [fileId]); renameContainer(fileId, 'Named');
  closeContainer(fileId); const savedClosed = useWorkbenchStore.getState().lastClosed!; await undoCloseContainer();
  expect(useWorkbenchStore.getState().snapshot.tabs.find(tab => tab.scope === 'code')).toMatchObject({ title: 'Named', groupId: 'g' });
  expect(useWorkbenchStore.getState().lastClosed).toBeNull();
  const closed = { ...savedClosed, groupId: 'missing' };
  useWorkbenchStore.setState({ lastClosed: closed }); await undoCloseContainer();
  expect(useWorkbenchStore.getState().lastClosed).toBeNull();
  useWorkbenchStore.setState({ lastClosed: { ...closed, scope: 'terminal' } }); await undoCloseContainer();
  expect(useWorkbenchStore.getState().lastClosed?.scope).toBe('terminal');
  const restore = vi.spyOn(restoreService, 'restoreWorkspaceComposition').mockImplementationOnce(async () => { useWorkbenchStore.setState({ snapshot: emptyWorkbench() }); });
  useWorkbenchStore.setState({ lastClosed: closed }); await undoCloseContainer(); expect(useWorkbenchStore.getState().lastClosed).toBeNull(); restore.mockRestore();
});

it('does not replace a utility page selected before hydration finishes', async () => {
  terminal(); synchronizeWorkbench(); useWorkspaceStore.getState().openHistoryTab();
  const id = useWorkspaceStore.getState().activeId;
  await restoreWorkbench('empty', vi.fn());
  expect(useWorkspaceStore.getState().activeId).toBe(id);
  expect(useWorkspaceStore.getState().tabs.find(tab => tab.id === id)?.kind).toBe('history');
});

it('clears deletion suppression when storage fails and allows the confirmed group deletion to retry', async () => {
  document(); synchronizeWorkbench(); group('retry-deletion', 'code', [fileId]);
  const tab = current(fileId); const resources = [{ id: fileId, title: 'a.ts', kind: 'document' as const, file }];
  const captured = captureContainerHistory(tab, resources); await persistContainerHistory(tab, captured);
  vi.mocked(groupApi.groupDeleteWithSessions).mockRejectedValueOnce(new Error('deletion storage failed'));
  const error = vi.fn(); removeWorkspaceGroup('retry-deletion', 'delete', error);
  await vi.waitFor(() => expect(error).toHaveBeenCalledWith(new Error('deletion storage failed')));
  await persistContainerHistory(tab, captured);
  removeWorkspaceGroup('retry-deletion', 'delete', error);
  await vi.waitFor(() => expect(useWorkbenchStore.getState().snapshot.groups).toEqual([]));
});

it('keeps native closure and group operations isolated from unrelated groups and resources', async () => {
  document(); terminal(); synchronizeWorkbench(); group('code', 'code', [fileId]); group('other', 'code');
  await assignWorkspaceGroup(fileId, 'other');
  await updateWorkspaceGroup('code', { title: 'First' });
  useWorkspaceStore.setState({ groups: [{ id: 'g', title: 'One', collapsed: false }, { id: 'h', title: 'Two', collapsed: false }] });
  synchronizeWorkbench(); await updateWorkspaceGroup('g', { collapsed: true });
  expect(useWorkspaceStore.getState().groups[1]!.title).toBe('Two');
  closeContainer('native'); expect(useWorkspaceStore.getState().tabs.some(tab => tab.kind === 'session')).toBe(false);
  expect(terminalLayoutFromContainer(current(fileId))).toBeNull();
  const error = vi.fn(); removeWorkspaceGroup('code', 'archive', error); await vi.waitFor(() => expect(useWorkbenchStore.getState().snapshot.groups.some(group => group.id === 'code')).toBe(false));
  expect(current(fileId)).toBeTruthy();
});

it('reports history-write failure before group archival and does not close the live members', async () => {
  document(); synchronizeWorkbench(); group('g', 'code', [fileId]);
  vi.mocked(saveWorkspaceHistory).mockRejectedValueOnce(new Error('storage unavailable'));
  const error = vi.fn(); removeWorkspaceGroup('g', 'archive', error); await vi.waitFor(() => expect(error).toHaveBeenCalledOnce());
  expect(current(fileId)).toBeTruthy(); expect(groupApi.groupArchive).not.toHaveBeenCalled();
});

it('keeps pane and history identifiers bounded even when a document path is long', async () => {
  const file = { path: `/repo/${'nested/'.repeat(50)}file.ts` }; useWorkspaceStore.getState().openEditorFile(file); synchronizeWorkbench();
  const id = `file:${editorFileKey(file)}`; const tab = current(id);
  expect(tab.focused.length).toBeLessThan(256); expect(parseWorkbench(useWorkbenchStore.getState().snapshot), JSON.stringify(useWorkbenchStore.getState().snapshot)).not.toBeNull();
  const captured = captureContainerHistory(tab, [{ id, title: 'file.ts', kind: 'document', file }]);
  await Promise.all([persistContainerHistory(tab, captured), persistContainerHistory(tab, captured)]);
  expect(vi.mocked(saveWorkspaceHistory).mock.calls[0]![0].id.length).toBeLessThan(256);
  expect(saveWorkspaceHistory).toHaveBeenCalledOnce();
});

it('retries a failed close save under the same captured history identity after its live owner is gone', async () => {
  document(); synchronizeWorkbench(); vi.mocked(saveWorkspaceHistory).mockRejectedValueOnce(new Error('close storage failed'));
  closeContainer(fileId);
  await vi.waitFor(() => expect(useWorkbenchFeedback.getState().failure?.error).toEqual(new Error('close storage failed')));
  const id = vi.mocked(saveWorkspaceHistory).mock.calls[0]![0].id;
  useWorkbenchFeedback.getState().failure!.retry(); await vi.waitFor(() => expect(saveWorkspaceHistory).toHaveBeenCalledTimes(2));
  expect(vi.mocked(saveWorkspaceHistory).mock.calls[1]![0].id).toBe(id);
});

it('handles reentrant observers and missing native projections without recursive synchronization', () => {
  terminal(); const stop = startWorkbenchRuntime();
  const unsubscribe = useWorkbenchStore.subscribe(() => synchronizeWorkbench());
  document(); synchronizeWorkbench();
  useWorkbenchStore.getState().update(state => ({ ...state, tabs: [...state.tabs, { id: 'missing', scope: 'terminal', layout: null, focused: '', zoomed: null }] }));
  useWorkbenchStore.getState().update(state => ({ ...state, tabs: state.tabs.map(tab => tab.id === fileId ? { ...tab, title: 'Changed' } : tab) }));
  useTerminalStore.setState({ focusedPaneId: 'native#0' });
  expect(useWorkbenchStore.getState().snapshot.selected.terminal).toBe('native');
  unsubscribe(); stop();
});

it('retains unrelated terminal groups when deleting a populated group', async () => {
  terminal('one'); terminal('two');
  useWorkspaceStore.setState(state => ({ groups: [{ id: 'g', title: 'One', collapsed: false }, { id: 'h', title: 'Two', collapsed: false }], tabs: state.tabs.map(tab => tab.kind === 'session' ? { ...tab, groupId: tab.id === 'one' ? 'g' : 'h' } : tab) }));
  synchronizeWorkbench(); removeWorkspaceGroup('g', 'delete', vi.fn());
  await vi.waitFor(() => expect(useWorkspaceStore.getState().groups).toEqual([{ id: 'h', title: 'Two', collapsed: false }]));
});

it('merges native session containers without closing their live pane resources', async () => {
  terminal('one'); terminal('two'); document(); synchronizeWorkbench();
  expect(await mergeWorkspaceContainers('missing', 'one', { leafId: 'one#0', dir: 'row', position: 'second' })).toBe(false);
  expect(await mergeWorkspaceContainers('two', 'one', { leafId: 'one#0', dir: 'row', position: 'second' })).toBe(true);
  const native = useWorkspaceStore.getState().tabs.find(tab => tab.id === 'one');
  expect(native).toMatchObject({ layout: { type: 'split', second: { terminal: { id: 'two#0' } } } });
  expect(deleteSession).toHaveBeenCalledWith('two');
  expect(useWorkbenchStore.getState().snapshot.tabs.some(tab => tab.id === 'two')).toBe(false);
  zoomWorkspaceContainer('one'); expect(current('one').zoomed).toBeTruthy(); zoomWorkspaceContainer('one'); expect(current('one').zoomed).toBeNull(); zoomWorkspaceContainer('missing');
  useWorkbenchStore.getState().update(state => putContainer(state, { id: 'ghost', scope: 'terminal', focused: 'ghost', zoomed: null, layout: { type: 'pane', id: 'ghost', resourceId: 'terminal:missing' } }));
  expect(await mergeWorkspaceContainers('ghost', 'one', { leafId: 'one#0', dir: 'col', position: 'first' })).toBe(false);
});

it('merges document and AI containers through the same tree operation', async () => {
  document(); const second = { path: '/repo/b.ts' }; useWorkspaceStore.getState().openEditorFile(second); synchronizeWorkbench();
  const target = current(fileId).focused;
  expect(await mergeWorkspaceContainers(`file:${editorFileKey(second)}`, fileId, { leafId: target, dir: 'row', position: 'second' })).toBe(true);
  expect(panesOf(current(fileId))).toHaveLength(2);
  let complete: (() => void) | undefined; vi.mocked(interceptEditorClose).mockImplementation((_files, done) => { complete = done; return true; });
  removeContainerPane(fileId, `file:${editorFileKey(second)}`); expect(panesOf(current(fileId))).toHaveLength(2); complete!(); expect(panesOf(current(fileId))).toHaveLength(1);
  removeContainerPane('missing', fileId); removeContainerPane(fileId, fileId);
  const chat = conversation(); const id = mixed(fileId, chat);
  removeContainerPane(id, 'missing');
  vi.mocked(interceptEditorClose).mockReturnValue(false); removeContainerPane(id, chat); expect(panesOf(current(id))).toHaveLength(1);
  const ghost = { type: 'pane' as const, id: 'ghost', resourceId: 'acp:missing' };
  useWorkbenchStore.getState().update(state => putContainer(state, { id: 'ghost-tab', scope: 'unified', focused: ghost.id, zoomed: null, layout: { type: 'split', direction: 'row', ratio: 0.5, first: ghost, second: { ...ghost, id: 'other', resourceId: 'acp:other' } } }));
  removeContainerPane('ghost-tab', ghost.resourceId); expect(current('ghost-tab')).toBeTruthy();
});

it('retries collapsed group persistence and terminal transfers through the shared failure surface', async () => {
  terminal('one'); terminal('two'); synchronizeWorkbench();
  useWorkspaceStore.setState({ groups: [{ id: 'g', title: 'Group', collapsed: true }], tabs: useWorkspaceStore.getState().tabs.map(tab => tab.id === 'one' ? { ...tab, groupId: 'g' } : tab) });
  synchronizeWorkbench(); vi.mocked(groupApi.groupSetCollapsed).mockRejectedValueOnce(new Error('offline'));
  activateContainer('one'); await vi.waitFor(() => expect(useWorkbenchFeedback.getState().failure?.error).toBeInstanceOf(Error));
  useWorkbenchFeedback.getState().failure!.retry(); await vi.waitFor(() => expect(useWorkspaceStore.getState().groups[0]!.collapsed).toBe(false));
  const transfer = vi.spyOn(sessionManager, 'transferPanes').mockRejectedValueOnce(new Error('transfer failed')).mockRejectedValueOnce(new Error('still offline')).mockResolvedValue(undefined);
  await mergeWorkspaceContainers('two', 'one', { leafId: 'one#0', dir: 'row', position: 'second' });
  expect(useWorkbenchFeedback.getState().failure?.error).toEqual(new Error('transfer failed'));
  useWorkbenchFeedback.getState().failure!.retry(); await vi.waitFor(() => expect(useWorkbenchFeedback.getState().failure?.error).toEqual(new Error('still offline')));
  useWorkbenchFeedback.getState().failure!.retry(); await vi.waitFor(() => expect(transfer).toHaveBeenCalledTimes(3)); transfer.mockRestore();
});

it('persists draft-aware terminal order and refuses a group from a different scope', async () => {
  terminal(); document(); synchronizeWorkbench(); group('code-group', 'code');
  await assignWorkspaceGroup('native', 'code-group'); expect(current('native').groupId).toBeUndefined();
  await sessionManager.create('native', 'Draft'); await assignWorkspaceGroup('native');
  expect(groupApi.sessionSetGroup).not.toHaveBeenCalledWith('native', null);
  await persistWorkspaceOrder('terminal'); expect(groupApi.sessionsReorder).toHaveBeenCalledWith(null, []);
  const created = await createContainerGroup('native', 'First'); await createContainerGroup('native', 'Second');
  expect(useWorkbenchStore.getState().snapshot.groups.some(group => group.id === created)).toBe(true);
  useWorkspaceStore.setState(state => ({ tabs: [...state.tabs.filter(tab => tab.kind !== 'session'), ...state.tabs.filter(tab => tab.kind === 'session')] }));
  await persistWorkspaceOrder('terminal');
});

it('handles a container disappearing while its pane close guard is pending', () => {
  document(); const chat = conversation(); const id = mixed(fileId, chat);
  let finish!: () => void; vi.mocked(interceptEditorClose).mockImplementation((_files, done) => { finish = done; return true; });
  removeContainerPane(id, fileId); useWorkbenchStore.setState({ snapshot: emptyWorkbench() }); finish();
  expect(useWorkbenchStore.getState().snapshot.tabs.some(tab => tab.id === id)).toBe(false);
});

it('retries a partially created group with the same identity instead of creating another group', async () => {
  terminal(); synchronizeWorkbench();
  vi.mocked(groupApi.groupsReorder).mockRejectedValueOnce(new Error('order save failed'));
  await expect(createContainerGroup('native', 'Retry group', 'group:terminal:retry')).rejects.toThrow('order save failed');
  await createContainerGroup('native', 'Retry group', 'group:terminal:retry');
  expect(useWorkspaceStore.getState().groups).toHaveLength(1);
  expect(useWorkbenchStore.getState().snapshot.groups).toHaveLength(1);
  expect(current('native').groupId).toBe('group:terminal:retry');
  expect(groupApi.groupCreate).toHaveBeenNthCalledWith(2, 'group:terminal:retry', 'Retry group', expect.any(Number));
});
