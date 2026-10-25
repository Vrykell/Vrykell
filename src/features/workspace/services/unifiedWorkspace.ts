import { useWorkspaceNavigation } from '../stores/navigation';
import { useUnifiedWorkspace } from '../stores/unifiedWorkspace';
import { activateWorkspaceResource, closeWorkspaceResource, currentWorkspaceResources } from './workspaceResources';
import { selectWorkspaceArea } from './selectWorkspaceArea';
import { newEditorFile } from '@features/editor/services/documentActions';
import { useAiWorkspace } from '@features/chat/stores/aiWorkspace';
import { useChatStore } from '@features/chat/stores/chat';
import { useWorkspaceStore } from '../stores/workspace';
import { rebindWorkspaceResources, resolveWorkspaceResource, terminalWorkspaceLayout, workspacePaneCells } from '../model/workspaceResources';
import type { PaneTarget } from '@core/paneLayout';
import { editorFileKey } from '@core/editor';
import { gitComparisonKey } from '@core/git';
import { useHarnessWorkspace } from '@features/chat/stores/harnessWorkspace';
import { firstLeaf, leaves, type TerminalSpec } from '../model/windowLayout';
import { useTerminalStore } from '@features/terminal/stores/terminal';
import { useUiStore } from '../stores/ui';
import type { ShellType } from '@platform/shells';
import { scopedPaneStores } from '../stores/scopedPanes';

export function createUnifiedTerminal(spec?: TerminalSpec, target?: PaneTarget) {
  const state = useUnifiedWorkspace.getState();
  if (target && (!state.layout || workspacePaneCells(state.layout).length >= 4 || !workspacePaneCells(state.layout).some(cell => cell.id === target.leafId))) return;
  const id = useWorkspaceStore.getState().addTab(spec ? { kind: spec.kind, shellType: spec.shellType as ShellType | undefined, ssh: spec.ssh, cwd: spec.cwd, useProfileDirectory: spec.useProfileDirectory } : undefined);
  const resource = resolveWorkspaceResource(`terminal:${id}`, currentWorkspaceResources());
  if (!resource) return;
  if (target) state.place(resource.id, target);
  focusUnifiedResource(resource.id);
}

export function requestTerminalSplit(spec: TerminalSpec | null) {
  if (useWorkspaceNavigation.getState().area !== 'unified') { useUiStore.getState().beginSplit(spec); return; }
  const state = useUnifiedWorkspace.getState();
  if (!state.layout || workspacePaneCells(state.layout).length >= 4) return;
  const resourceId = workspacePaneCells(state.layout).find(cell => cell.id === state.focused)?.resourceId;
  const resource = resourceId ? resolveWorkspaceResource(resourceId, currentWorkspaceResources()) : undefined;
  const tab = useWorkspaceStore.getState().tabs.find(tab => resource?.kind === 'terminal' && tab.id === resource.tabId);
  const focused = useTerminalStore.getState().focusedPaneId;
  const inherited = tab?.kind === 'session' ? leaves(tab.layout).find(terminal => terminal.id === focused) ?? firstLeaf(tab.layout) : undefined;
  useUnifiedWorkspace.setState({ pendingTerminalSplit: spec ?? inherited ?? { id: '', kind: 'local' } });
}

export function closeTerminalPane(paneId: string) {
  if (useWorkspaceNavigation.getState().area !== 'unified') { useWorkspaceStore.getState().closeTerminal(paneId); return; }
  const state = useUnifiedWorkspace.getState();
  if (!state.layout || workspacePaneCells(state.layout).length < 2) return;
  const tab = useWorkspaceStore.getState().tabs.find(tab => tab.kind === 'session' && leaves(tab.layout).some(terminal => terminal.id === paneId));
  const resource = currentWorkspaceResources().find(resource => resource.kind === 'terminal' && resource.tabId === tab?.id && resource.paneId === paneId);
  const cell = state.layout && workspacePaneCells(state.layout).find(cell => cell.resourceId === resource?.id);
  if (cell && resource) removeUnifiedPane(resource.id);
}

export function removeUnifiedPane(resourceId: string) {
  const state = useUnifiedWorkspace.getState();
  if (!state.layout || workspacePaneCells(state.layout).length < 2) return;
  const cell = workspacePaneCells(state.layout).find(cell => cell.resourceId === resourceId); if (!cell) return;
  const resource = currentWorkspaceResources().find(resource => resource.id === resourceId);
  if (!resource) return;
  closeWorkspaceResource(resource);
  if (!currentWorkspaceResources().some(resource => resource.id === resourceId)) state.removePane(cell.id);
  const next = useUnifiedWorkspace.getState(); const remaining = next.layout && workspacePaneCells(next.layout).find(cell => cell.id === next.focused);
  if (remaining) focusUnifiedResource(remaining.resourceId);
}

export function createUnifiedResource(kind: 'terminal' | 'document' | 'conversation', direction?: 'row' | 'col', target?: PaneTarget) {
  const state = useUnifiedWorkspace.getState();
  if ((direction || target) && state.layout && workspacePaneCells(state.layout).length >= 4) return;
  if (target && (!state.layout || !workspacePaneCells(state.layout).some(cell => cell.id === target.leafId))) return;
  const previous = new Set(currentWorkspaceResources().map(resource => resource.id));
  if (kind === 'terminal') useWorkspaceStore.getState().addTab();
  else if (kind === 'document') newEditorFile();
  else {
    useAiWorkspace.getState().openNative(useChatStore.getState().createConversation());
    useWorkspaceStore.getState().openHarnessTab();
  }
  const resource = currentWorkspaceResources().find(resource => resource.kind === kind && !previous.has(resource.id));
  if (resource) {
    if (target) state.place(resource.id, target);
    else if (direction) state.split(resource.id, direction);
    focusUnifiedResource(resource.id);
  }
  useWorkspaceNavigation.getState().selectArea('unified');
}

export function focusUnifiedResource(id: string) {
  const resource = resolveWorkspaceResource(id, currentWorkspaceResources());
  if (!resource || resource.kind === 'page') return;
  useUnifiedWorkspace.getState().show(resource.id);
  activateWorkspaceResource(resource);
  useWorkspaceNavigation.getState().selectArea('unified');
}

/** Add a resource reference to the active composition, keeping one owner per pane. */
export function addUnifiedResource(id: string) {
  const resource = resolveWorkspaceResource(id, currentWorkspaceResources());
  if (!resource || resource.kind === 'page') return;
  useUnifiedWorkspace.setState({ zoomed: null });
  const state = useUnifiedWorkspace.getState();
  const cells = state.layout ? workspacePaneCells(state.layout) : [];
  if (state.layout && cells.length >= 4 && !cells.some(cell => cell.resourceId === resource.id)) {
    focusUnifiedResource(resource.id);
    return;
  }
  state.split(resource.id, 'row');
  focusUnifiedResource(resource.id);
}

export function showUnifiedTerminalGroup(tabId: string) {
  const tab = useWorkspaceStore.getState().tabs.find(tab => tab.id === tabId);
  if (tab?.kind !== 'session') return;
  const layout = terminalWorkspaceLayout(tab.layout);
  const focused = useTerminalStore.getState().focusedPaneId;
  useUnifiedWorkspace.getState().restore(layout, focused ?? firstLeaf(tab.layout).id);
  focusUnifiedResource(`terminal:${focused && leaves(tab.layout).some(terminal => terminal.id === focused) ? focused : firstLeaf(tab.layout).id}`);
}

export function openUnifiedWorkspace() {
  const state = useUnifiedWorkspace.getState();
  const resources = currentWorkspaceResources().filter(resource => resource.kind !== 'page');
  if (state.layout) {
    const layout = rebindWorkspaceResources(state.layout, resources);
    if (layout !== state.layout) useUnifiedWorkspace.setState({ layout });
  }
  state.reconcile(resources.map(resource => resource.id));
  selectWorkspaceArea('unified');
}

export function requestWorkspaceSplit(resourceId?: string, anchor?: { x: number; y: number }) {
  const navigation = useWorkspaceNavigation.getState(); const workspace = useWorkspaceStore.getState();
  if (navigation.area === 'terminal') { requestTerminalSplit(null); return; }
  if (navigation.area === 'code' || navigation.area === 'ai') {
    const area = navigation.area;
    const tab = workspace.tabs.find(tab => tab.id === workspace.activeId);
    const comparisonId = tab?.kind === 'git-diff'
      ? tab.comparisons?.find(item => gitComparisonKey(item.selection) === gitComparisonKey(tab.selection))?.id ?? tab.id
      : undefined;
    const id = resourceId ?? (area === 'ai' ? useAiWorkspace.getState().selected : tab?.kind === 'editor' ? `file:${editorFileKey(tab.selected)}` : tab?.kind === 'git-diff' ? `diff:${comparisonId}` : undefined);
    const resource = currentWorkspaceResources().find(resource => resource.id === id);
    if (!resource || (area === 'code' ? resource.kind !== 'document' && resource.kind !== 'comparison' : resource.kind !== 'conversation' && resource.kind !== 'agent')) return;
    const store = scopedPaneStores[area];
    store.getState().show(resource.id);
    if (store.getState().layout && workspacePaneCells(store.getState().layout!).length >= 4) return;
    store.setState({ choosingSplit: true, splitAnchor: anchor });
    return;
  }
  if (navigation.area !== 'unified') return;
  openUnifiedWorkspace();
  if (resourceId) focusUnifiedResource(resourceId);
  useUnifiedWorkspace.setState({ choosingSplit: true, startActive: false, zoomed: null });
}

export function connectUnifiedAgent(harness: string, target?: PaneTarget, directory?: string) {
  const workspace = useWorkspaceStore.getState();
  if (target) {
    const layout = useUnifiedWorkspace.getState().layout;
    if (!layout || workspacePaneCells(layout).length >= 4 || !workspacePaneCells(layout).some(cell => cell.id === target.leafId)) return;
    const source = layout && workspacePaneCells(layout).find(cell => cell.id === target.leafId)?.resourceId;
    const agents = useHarnessWorkspace.getState();
    const cwd = directory ?? (source?.startsWith('acp:') ? agents.connections.find(connection => `acp:${connection.id}` === source)?.cwd : undefined);
    const id = agents.connect(harness, cwd, true);
    workspace.openHarnessTab(); useUnifiedWorkspace.getState().place(`acp:${id}`, target); focusUnifiedResource(`acp:${id}`);
  } else {
    workspace.openHarnessTab(harness, directory); const id = useHarnessWorkspace.getState().selected;
    if (id) focusUnifiedResource(`acp:${id}`);
  }
}
