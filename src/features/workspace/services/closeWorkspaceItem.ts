import { useWorkspaceStore, isSessionTab } from '../stores/workspace';
import { useWorkspaceNavigation, workspaceAreaForKind } from '../stores/navigation';
import { closeAiWorkspaceSession, useAiWorkspace } from '@features/chat';
import { focusedWorkspaceArea, sideAiHasFocus } from './workspaceActions';
import { selectWorkspaceArea } from './selectWorkspaceArea';
import { gitComparisonKey } from '@core/git';
import { useWorkbenchStore } from '../stores/workbench';
import { closeContainer } from './workbench';

/** Close the visible instance instead of the enclosing functional workspace. */
export function closeWorkspaceItem() {
  const workspace = useWorkspaceStore.getState();
  const tab = workspace.tabs.find(item => item.id === workspace.activeId);
  if (sideAiHasFocus()) {
    closeAiWorkspaceSession(useAiWorkspace.getState().sideSelected);
    return;
  }
  const navigation = useWorkspaceNavigation.getState();
  if (navigation.area === 'terminal' || navigation.area === 'code' || navigation.area === 'ai' || navigation.area === 'unified') {
    const selected = useWorkbenchStore.getState().snapshot.selected[navigation.area];
    const container = useWorkbenchStore.getState().snapshot.tabs.find(tab => tab.id === selected && tab.layout);
    const system = tab?.kind === 'history' || tab?.kind === 'ai-history' || tab?.kind === 'usage';
    if (container && !system) { closeContainer(container.id); return; }
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
