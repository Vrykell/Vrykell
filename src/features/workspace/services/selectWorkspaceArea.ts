import { useWorkspaceStore } from '../stores/workspace';
import { useUiStore } from '../stores/ui';
import { useWorkspaceNavigation, workspaceAreaForKind, type WorkspaceArea } from '../stores/navigation';

export function selectWorkspaceArea(area: WorkspaceArea) {
  const navigation = useWorkspaceNavigation.getState();
  const workspace = useWorkspaceStore.getState();
  useUiStore.getState().setSettingsOpen(false);
  navigation.selectArea(area);
  if (area === 'ai') {
    navigation.setAiPlacement('main');
    workspace.openHarnessTab();
    return;
  }
  const candidate = workspace.tabs.find(tab => tab.id === navigation.lastTabs[area] && workspaceAreaForKind(tab.kind) === area)
    ?? workspace.tabs.find(tab => workspaceAreaForKind(tab.kind) === area);
  if (candidate && area !== 'ssh') workspace.activate(candidate.id);
}
