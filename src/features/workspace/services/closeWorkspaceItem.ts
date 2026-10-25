import { useWorkspaceStore, isSessionTab } from '../stores/workspace';
import { useWorkspaceNavigation, workspaceAreaForKind } from '../stores/navigation';
import { closeAiWorkspaceSession, useAiWorkspace } from '@features/chat';
import { focusedWorkspaceArea, sideAiHasFocus } from './workspaceActions';
import { selectWorkspaceArea } from './selectWorkspaceArea';
import { useUnifiedWorkspace } from '../stores/unifiedWorkspace';
import { closeCompositionTab } from './compositionTabs';
import { gitComparisonKey } from '@core/git';

/** Close the visible instance instead of the enclosing functional workspace. */
export function closeWorkspaceItem() {
  const workspace = useWorkspaceStore.getState();
  const tab = workspace.tabs.find(item => item.id === workspace.activeId);
  if (sideAiHasFocus()) {
    closeAiWorkspaceSession(useAiWorkspace.getState().sideSelected);
    return;
  }
  const navigation = useWorkspaceNavigation.getState();
  if (navigation.area === 'unified') {
    const state = useUnifiedWorkspace.getState();
    closeCompositionTab(state.activeTabId);
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
  else if (tab.kind === 'git-diff') {
    const comparison = tab.comparisons?.find(item => gitComparisonKey(item.selection) === gitComparisonKey(tab.selection));
    workspace.closeGitComparison(comparison?.id ?? tab.id);
  }
  else if (isSessionTab(tab)) workspace.closeFocusedTerminal();
  else workspace.closeTab(tab.id);
}
