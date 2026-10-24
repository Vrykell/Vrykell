import { useWorkspaceNavigation } from '../stores/navigation';
import { useUnifiedWorkspace } from '../stores/unifiedWorkspace';
import { activateWorkspaceResource, currentWorkspaceResources } from './workspaceResources';
import { selectWorkspaceArea } from './selectWorkspaceArea';
import { newEditorFile } from '@features/editor/services/documentActions';
import { useAiWorkspace } from '@features/chat/stores/aiWorkspace';
import { useChatStore } from '@features/chat/stores/chat';
import { useWorkspaceStore } from '../stores/workspace';
import { workspacePaneCells } from '../model/workspaceResources';
import type { PaneTarget } from '@core/paneLayout';
import { editorFileKey } from '@core/editor';
import { useHarnessWorkspace } from '@features/chat/stores/harnessWorkspace';

export function createUnifiedResource(kind: 'terminal' | 'document' | 'conversation', direction?: 'row' | 'col', target?: PaneTarget) {
  const state = useUnifiedWorkspace.getState();
  if ((direction || target) && state.layout && workspacePaneCells(state.layout).length >= 4) return;
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
  const resource = currentWorkspaceResources().find(item => item.id === id);
  if (!resource || resource.kind === 'page') return;
  useUnifiedWorkspace.getState().show(id);
  activateWorkspaceResource(resource);
  useWorkspaceNavigation.getState().selectArea('unified');
}

export function openUnifiedWorkspace() {
  useUnifiedWorkspace.getState().reconcile(currentWorkspaceResources().filter(resource => resource.kind !== 'page').map(resource => resource.id));
  selectWorkspaceArea('unified');
}

export function requestWorkspaceSplit(resourceId?: string) {
  const navigation = useWorkspaceNavigation.getState(); const workspace = useWorkspaceStore.getState();
  if (!resourceId && navigation.area !== 'unified') {
    const tab = workspace.tabs.find(tab => tab.id === workspace.activeId);
    resourceId = tab?.kind === 'editor' ? `file:${editorFileKey(tab.selected)}` : navigation.area === 'ai' ? useAiWorkspace.getState().selected : undefined;
  }
  openUnifiedWorkspace();
  if (resourceId) focusUnifiedResource(resourceId);
  useUnifiedWorkspace.setState({ choosingSplit: true, startActive: false });
}

export function connectUnifiedAgent(harness: string, target?: PaneTarget) {
  const workspace = useWorkspaceStore.getState();
  if (target) {
    const layout = useUnifiedWorkspace.getState().layout;
    const source = layout && workspacePaneCells(layout).find(cell => cell.id === target.leafId)?.resourceId;
    const agents = useHarnessWorkspace.getState();
    const cwd = source?.startsWith('acp:') ? agents.connections.find(connection => `acp:${connection.id}` === source)?.cwd : undefined;
    const id = agents.connect(harness, cwd, true);
    workspace.openHarnessTab(); useUnifiedWorkspace.getState().place(`acp:${id}`, target); focusUnifiedResource(`acp:${id}`);
  } else {
    workspace.openHarnessTab(harness); const id = useHarnessWorkspace.getState().selected;
    if (id) focusUnifiedResource(`acp:${id}`);
  }
}
