import { useWorkspaceStore, isSessionTab } from '../stores/workspace';
import { useWorkspaceNavigation, workspaceAreaForKind } from '../stores/navigation';
import { closeAiWorkspaceSession, useChatStore } from '@features/chat';
import { useDockStore } from '../stores/dock';
import { focusedWorkspaceArea, sideAiHasFocus } from './workspaceActions';
import { selectWorkspaceArea } from './selectWorkspaceArea';
import { useUnifiedWorkspace } from '../stores/unifiedWorkspace';
import { workspacePaneCells } from '../model/workspaceResources';
import { closeWorkspaceResource, currentWorkspaceResources } from './workspaceResources';

/** Close the visible instance instead of the enclosing functional workspace. */
export function closeWorkspaceItem() {
  const workspace = useWorkspaceStore.getState();
  const tab = workspace.tabs.find(item => item.id === workspace.activeId);
  if (sideAiHasFocus()) {
    closeAiWorkspaceSession(`chat:${useChatStore.getState().activeConversationId}`);
    useDockStore.getState().closePanel('chat');
    return;
  }
  const navigation = useWorkspaceNavigation.getState();
  if (navigation.area === 'unified') {
    const state = useUnifiedWorkspace.getState();
    if (state.startActive) { state.closeStart(); return; }
    const id = state.layout && workspacePaneCells(state.layout).find(cell => cell.id === state.focused)?.resourceId;
    const resource = currentWorkspaceResources().find(item => item.id === id);
    if (resource) closeWorkspaceResource(resource);
    return;
  }
  if (navigation.area === 'history') {
    selectWorkspaceArea(navigation.previousArea === 'history' ? 'terminal' : navigation.previousArea);
    return;
  }
  if (focusedWorkspaceArea() === 'ai' && tab?.kind === 'harness') {
    closeAiWorkspaceSession();
    return;
  }
  if (!tab || workspaceAreaForKind(tab.kind) !== useWorkspaceNavigation.getState().area) return;
  if (tab.kind === 'editor') workspace.closeEditorFile(tab.selected);
  else if (tab.kind === 'git-diff') workspace.closeGitComparison(tab.comparisons?.find(item => item.selection === tab.selection)?.id ?? tab.id);
  else if (isSessionTab(tab)) workspace.closeFocusedTerminal();
  else workspace.closeTab(tab.id);
}
