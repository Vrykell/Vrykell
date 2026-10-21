import { useWorkspaceStore, isSessionTab } from '../stores/workspace';
import { useWorkspaceNavigation, workspaceAreaForKind } from '../stores/navigation';
import { closeAiWorkspaceSession } from '@features/chat';
import { focusedWorkspaceArea, sideAiHasFocus } from './workspaceActions';

/** Close the visible instance instead of the enclosing functional workspace. */
export function closeWorkspaceItem() {
  const workspace = useWorkspaceStore.getState();
  const tab = workspace.tabs.find(item => item.id === workspace.activeId);
  if (focusedWorkspaceArea() === 'ai' && (sideAiHasFocus() || tab?.kind === 'harness')) {
    if (sideAiHasFocus() || useWorkspaceNavigation.getState().aiPlacement === 'main') closeAiWorkspaceSession();
    return;
  }
  if (!tab || workspaceAreaForKind(tab.kind) !== useWorkspaceNavigation.getState().area) return;
  if (tab.kind === 'editor') workspace.closeEditorFile(tab.selected);
  else if (tab.kind === 'git-diff') workspace.closeGitComparison(tab.comparisons?.find(item => item.selection === tab.selection)?.id ?? tab.id);
  else if (isSessionTab(tab)) workspace.closeFocusedTerminal();
  else workspace.closeTab(tab.id);
}
