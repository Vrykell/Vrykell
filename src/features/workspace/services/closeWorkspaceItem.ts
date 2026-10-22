import { useWorkspaceStore, isSessionTab } from '../stores/workspace';
import { useWorkspaceNavigation, workspaceAreaForKind } from '../stores/navigation';
import { closeAiWorkspaceSession, useChatStore } from '@features/chat';
import { useDockStore } from '../stores/dock';
import { focusedWorkspaceArea, sideAiHasFocus } from './workspaceActions';
import { selectWorkspaceArea } from './selectWorkspaceArea';

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
