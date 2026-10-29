import { useWorkspaceStore } from '../stores/workspace';
import { useUiStore } from '../stores/ui';
import { useWorkspaceNavigation, workspaceAreaForKind, type HistoryTypePreset, type WorkspaceArea } from '../stores/navigation';
import { useWorkbenchStore } from '../stores/workbench';
import { activateContainer } from './workbench';
import { WORKSPACE_SCOPES, type WorkspaceScope } from '../model/workbench';

const isScope = (area: WorkspaceArea): area is WorkspaceScope => WORKSPACE_SCOPES.some(scope => scope === area);
const systemPage = (kind: string) => kind === 'history' || kind === 'ai-history' || kind === 'usage';

export function selectWorkspaceArea(area: WorkspaceArea, historyPreset: HistoryTypePreset = 'all') {
  const navigation = useWorkspaceNavigation.getState();
  const workspace = useWorkspaceStore.getState();
  const snapshot = useWorkbenchStore.getState().snapshot;
  if (isScope(navigation.area)) {
    const page = workspace.tabs.find(tab => tab.id === workspace.activeId && workspaceAreaForKind(tab.kind) === navigation.area);
    const id = page && systemPage(page.kind) ? page.id : snapshot.selected[navigation.area] ?? page?.id;
    if (id) navigation.rememberTab(navigation.area, id);
  }
  useUiStore.getState().setSettingsOpen(false);
  if (area === 'history') {
    navigation.selectHistory(historyPreset);
    return;
  }
  navigation.selectArea(area);
  const remembered = useWorkspaceNavigation.getState().lastTabs[area];
  const rememberedPage = workspace.tabs.find(tab => tab.id === remembered && workspaceAreaForKind(tab.kind) === area);
  if (rememberedPage && systemPage(rememberedPage.kind)) {
    if (area === 'ai') navigation.setAiPlacement('main');
    workspace.activate(rememberedPage.id);
    return;
  }
  if (isScope(area)) {
    const tab = snapshot.tabs.find(tab => tab.id === remembered && tab.scope === area)
      ?? snapshot.tabs.find(tab => tab.id === snapshot.selected[area] && tab.scope === area);
    if (tab) {
      if (area === 'ai') navigation.setAiPlacement('main');
      activateContainer(tab.id); return;
    }
  }
  if (area === 'ssh' || area === 'forwarding' || area === 'unified') return;
  if (area === 'ai') {
    navigation.setAiPlacement('main');
    workspace.openHarnessTab();
    return;
  }
  const candidate = rememberedPage
    ?? workspace.tabs.find(tab => workspaceAreaForKind(tab.kind) === area && !systemPage(tab.kind));
  if (candidate) workspace.activate(candidate.id);
}
