import { beforeEach, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from '../stores/workspace';
import { useWorkspaceNavigation } from '../stores/navigation';
import { compositionTabs, useUnifiedWorkspace } from '../stores/unifiedWorkspace';
import { useAiWorkspace } from '@features/chat/stores/aiWorkspace';
import { useChatStore } from '@features/chat/stores/chat';
import { useHarnessWorkspace } from '@features/chat/stores/harnessWorkspace';
import { addUnifiedResource, closeTerminalPane, connectUnifiedAgent, createUnifiedResource, createUnifiedTerminal, requestTerminalSplit, requestWorkspaceSplit, showUnifiedTerminalGroup } from '../services/unifiedWorkspace';
import { renameWorkspaceResource } from '../services/workspaceResources';
import { workspacePaneCells, workspacePaneIds } from '../model/workspaceResources';
import { leaf } from '../model/windowLayout';
import { scopedPaneStores } from '../stores/scopedPanes';
import { useUiStore } from '../stores/ui';

vi.mock('@platform/diagnostics', () => ({ invoke: vi.fn(async () => undefined), diagnostic: vi.fn() }));
beforeEach(() => {
  useWorkspaceStore.setState({ tabs: [], activeId: '' });
  useWorkspaceNavigation.setState({ area: 'unified' });
  useUnifiedWorkspace.setState({ layout: null, focused: '', order: [] });
  useAiWorkspace.setState({ nativeTabs: [], selected: '', order: [] });
  useChatStore.setState({ conversations: [], byTab: {} });
  useHarnessWorkspace.setState({ connections: [] });
  for (const store of Object.values(scopedPaneStores)) store.setState({ layout: null, focused: '', choosingSplit: false });
});

it('creates and splits new resources without replacing the existing pane or exceeding the owner limit', () => {
  createUnifiedResource('terminal');
  const terminal = useUnifiedWorkspace.getState().layout!;
  createUnifiedResource('document', 'row');
  createUnifiedResource('conversation', 'col');
  createUnifiedResource('terminal', 'row');
  const layout = useUnifiedWorkspace.getState().layout!;
  expect(workspacePaneIds(layout).map(id => id.split(':')[0])).toEqual(['terminal', 'file', 'chat', 'terminal']);
  expect(layout.type === 'split' && layout.first).toBe(terminal);
  const tabs = useWorkspaceStore.getState().tabs;
  createUnifiedResource('document', 'col');
  expect(useWorkspaceStore.getState().tabs).toBe(tabs);
  expect(useUnifiedWorkspace.getState().layout).toBe(layout);
  expect(useWorkspaceNavigation.getState().area).toBe('unified');
});

it('splits an agent through its existing connection model and preserves its directory', () => {
  const source = useHarnessWorkspace.getState().connect('agent', '/work/project');
  useUnifiedWorkspace.setState({ layout: { type: 'pane', id: 'source', resourceId: `acp:${source}` }, focused: 'source' });
  connectUnifiedAgent('agent', { leafId: 'source', dir: 'row', position: 'second', rect: { x: 0.5, y: 0, w: 0.5, h: 1 } });
  const connections = useHarnessWorkspace.getState().connections;
  expect(connections).toHaveLength(2);
  expect(connections[1]).toMatchObject({ harness: 'agent', cwd: '/work/project', fresh: true });
  expect(connections[1]!.id).not.toBe(source);
  expect(workspacePaneIds(useUnifiedWorkspace.getState().layout!)).toEqual([`acp:${source}`, `acp:${connections[1]!.id}`]);
});

it('delegates common tab renaming to the original owner', () => {
  createUnifiedResource('terminal');
  const tab = useWorkspaceStore.getState().tabs[0]!;
  renameWorkspaceResource({ kind: 'terminal', id: `terminal:${tab.id}`, tabId: tab.id, title: tab.title }, 'Updated shell');
  expect(useWorkspaceStore.getState().tabs[0]!.title).toBe('Updated shell');
});

it('projects existing terminal panes into one layout and splits through a separate terminal owner', () => {
  const first = leaf({ id: 'source#0', kind: 'local', shellType: 'zsh' });
  const second = leaf({ id: 'source#1', kind: 'local', shellType: 'bash' });
  useWorkspaceStore.setState({ tabs: [{ id: 'source', kind: 'session', title: 'Shells', layout: { type: 'split', dir: 'row', ratio: 0.6, first, second } }] });
  showUnifiedTerminalGroup('source');
  expect(workspacePaneIds(useUnifiedWorkspace.getState().layout!)).toEqual(['terminal:source#0', 'terminal:source#1']);
  const before = useWorkspaceStore.getState().tabs[0];
  requestTerminalSplit({ id: '', kind: 'local', shellType: 'cmd' });
  expect(useUnifiedWorkspace.getState().pendingTerminalSplit).toMatchObject({ shellType: 'cmd' });
  createUnifiedTerminal(useUnifiedWorkspace.getState().pendingTerminalSplit, { leafId: 'source#0', dir: 'col', position: 'second', rect: { x: 0, y: 0.5, w: 0.5, h: 0.5 } });
  expect(useWorkspaceStore.getState().tabs[0]).toBe(before);
  expect(workspacePaneIds(useUnifiedWorkspace.getState().layout!)).toHaveLength(3);
  closeTerminalPane('source#1');
  expect(useWorkspaceStore.getState().tabs[0]).not.toBe(before);
  expect(useWorkspaceStore.getState().tabs[0]).toMatchObject({ kind: 'session', layout: first });
  expect(workspacePaneIds(useUnifiedWorkspace.getState().layout!)).not.toContain('terminal:source#1');
});

it('retains an explicit restore destination while changing history presets', () => {
  const navigation = useWorkspaceNavigation.getState();
  navigation.selectHistory('all');
  expect(useWorkspaceNavigation.getState().historyDestination).toBe('unified');
  navigation.selectHistory('terminal');
  expect(useWorkspaceNavigation.getState().historyDestination).toBe('unified');
  navigation.selectArea('terminal'); navigation.selectHistory('all');
  expect(useWorkspaceNavigation.getState().historyDestination).toBe('native');
});

it('does not remove the only common pane through stale menu or editor actions', () => {
  createUnifiedResource('terminal');
  const state = useUnifiedWorkspace.getState();
  const tab = useWorkspaceStore.getState().tabs[0]!;
  expect(tab.kind).toBe('session');
  const paneId = tab.kind === 'session' && tab.layout.type === 'leaf' ? tab.layout.terminal.id : '';
  closeTerminalPane(paneId);
  state.removePane(state.focused);
  expect(useUnifiedWorkspace.getState().layout).toBe(state.layout);
  expect(useWorkspaceStore.getState().tabs[0]).toBe(tab);
});

it('routes both legacy history actions through the common origin and resets native pages explicitly', () => {
  useWorkspaceStore.getState().openAiHistoryTab();
  expect(useWorkspaceNavigation.getState()).toMatchObject({ area: 'history', historyDestination: 'unified', historyPreset: 'conversation' });
  useWorkspaceNavigation.getState().selectArea('unified');
  useWorkspaceStore.getState().openHistoryTab();
  expect(useWorkspaceNavigation.getState()).toMatchObject({ area: 'history', historyDestination: 'unified', historyPreset: 'terminal' });
  useWorkspaceNavigation.getState().selectArea('ai');
  useWorkspaceStore.getState().openAiHistoryTab();
  expect(useWorkspaceNavigation.getState().historyDestination).toBe('native');
});

it('keeps editor, conversation and terminal split requests in their original workspace', () => {
  createUnifiedResource('document');
  const document = useUnifiedWorkspace.getState().layout!;
  expect(document.type).toBe('pane');
  useWorkspaceNavigation.getState().selectArea('code');
  requestWorkspaceSplit(document.type === 'pane' ? document.resourceId : undefined, { x: 700, y: 44 });
  expect(useWorkspaceNavigation.getState().area).toBe('code');
  expect(scopedPaneStores.code.getState().choosingSplit).toBe(true);
  expect(scopedPaneStores.code.getState().splitAnchor).toEqual({ x: 700, y: 44 });
  createUnifiedResource('conversation');
  useWorkspaceNavigation.getState().selectArea('ai');
  requestWorkspaceSplit(useAiWorkspace.getState().selected);
  expect(useWorkspaceNavigation.getState().area).toBe('ai');
  expect(scopedPaneStores.ai.getState().choosingSplit).toBe(true);
  useWorkspaceNavigation.getState().selectArea('terminal');
  requestWorkspaceSplit();
  expect(useUiStore.getState().splitPlacement.open).toBe(true);
  expect(useWorkspaceNavigation.getState().area).toBe('terminal');
});

it('never adds a fifth pane when a switcher selection arrives at a full composition', () => {
  useWorkspaceStore.setState({
    tabs: [
      { id: 'one', kind: 'session', title: 'One', layout: leaf({ id: 'one#0', kind: 'local' }) },
      { id: 'two', kind: 'session', title: 'Two', layout: leaf({ id: 'two#0', kind: 'local' }) },
      { id: 'history', kind: 'history', title: 'History' },
    ],
  });
  const panes = ['a', 'b', 'c', 'd'].map((key, index) => ({ type: 'pane' as const, id: `pane-${index}`, resourceId: `terminal:${key}` }));
  useUnifiedWorkspace.setState({ activeTabId: '', focused: 'pane-0', layout: {
    type: 'split', direction: 'row', ratio: 0.5,
    first: { type: 'split', direction: 'row', ratio: 0.5, first: panes[0]!, second: panes[1]! },
    second: { type: 'split', direction: 'row', ratio: 0.5, first: panes[2]!, second: panes[3]! },
  } });

  addUnifiedResource('terminal:two#0');
  expect(workspacePaneIds(useUnifiedWorkspace.getState().layout!)).toEqual(['terminal:two#0']);
  expect(compositionTabs().some(tab => tab.paneLayout && workspacePaneCells(tab.paneLayout).length === 4)).toBe(true);
  expect(compositionTabs().every(tab => !tab.paneLayout || workspacePaneCells(tab.paneLayout).length <= 4)).toBe(true);

  const current = useUnifiedWorkspace.getState().layout;
  addUnifiedResource('page:history');
  expect(useUnifiedWorkspace.getState().layout).toBe(current);
});
