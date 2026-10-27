import { useWorkspaceStore } from '../stores/workspace';
import { useUiStore } from '../stores/ui';
import { useWorkspaceNavigation, workspaceAreaForKind, type HistoryTypePreset, type WorkspaceArea } from '../stores/navigation';
import { useWorkbenchStore } from '../stores/workbench';
import { activateContainer } from './workbench';

export function selectWorkspaceArea(area: WorkspaceArea, historyPreset: HistoryTypePreset = 'all') {
  const navigation = useWorkspaceNavigation.getState();
  const workspace = useWorkspaceStore.getState();
  useUiStore.getState().setSettingsOpen(false);
  if (area === 'history') {
    navigation.selectHistory(historyPreset);
    return;
  }
  navigation.selectArea(area);
  if (area === 'terminal' || area === 'code' || area === 'ai' || area === 'unified') {
    const id = useWorkbenchStore.getState().snapshot.selected[area];
    if (id && useWorkbenchStore.getState().snapshot.tabs.some(tab => tab.id === id && tab.layout)) {
      if (area === 'ai') navigation.setAiPlacement('main');
      activateContainer(id); return;
    }
  }
  if (area === 'ssh' || area === 'forwarding' || area === 'unified') return;
  if (area === 'ai') {
    navigation.setAiPlacement('main');
    workspace.openHarnessTab();
    return;
  }
  const systemPage = (kind: string) => kind === 'history' || kind === 'ai-history' || kind === 'usage';
  const candidate = workspace.tabs.find(tab => tab.id === navigation.lastTabs[area] && workspaceAreaForKind(tab.kind) === area && !systemPage(tab.kind))
    ?? workspace.tabs.find(tab => workspaceAreaForKind(tab.kind) === area && !systemPage(tab.kind));
  if (candidate) workspace.activate(candidate.id);
}
