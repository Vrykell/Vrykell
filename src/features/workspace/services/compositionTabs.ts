import { interceptEditorClose } from '@core/editor';
import { interceptHarnessClose } from '@core/harness';
import { useWorkspaceStore } from '../stores/workspace';
import { compositionTabs, selectCompositionTab, useUnifiedWorkspace } from '../stores/unifiedWorkspace';
import { workspacePaneCells } from '../model/workspaceResources';
import { activateWorkspaceResource, closeWorkspaceResource, currentWorkspaceResources } from './workspaceResources';
import { captureWorkspaceHistory } from './workspaceHistory';
import { useWorkspaceNavigation } from '../stores/navigation';

export function activateCompositionTab(id: string) {
  selectCompositionTab(id);
  const state = useUnifiedWorkspace.getState();
  const cells = state.layout ? workspacePaneCells(state.layout) : [];
  const pane = cells.find(cell => cell.id === state.focused) ?? cells[0];
  const resource = currentWorkspaceResources().find(resource => resource.id === pane?.resourceId);
  if (resource) activateWorkspaceResource(resource);
  useWorkspaceNavigation.getState().selectArea('unified');
}

export function closeCompositionTab(id: string, force = false) {
  const tab = compositionTabs().find(tab => tab.id === id); if (!tab) return;
  const all = currentWorkspaceResources();
  const ids = new Set(tab.paneLayout ? workspacePaneCells(tab.paneLayout).map(cell => cell.resourceId) : []);
  const resources = all.filter(resource => ids.has(resource.id));
  const complete = () => {
    const snapshot = captureWorkspaceHistory(tab.paneLayout, tab.focusedPane, all, true) ?? undefined;
    const neighbors = compositionTabs().filter(item => item.id !== id);
    const active = useUnifiedWorkspace.getState().activeTabId;
    for (const resource of resources) closeWorkspaceResource(resource, true);
    useWorkspaceStore.getState().closeTab(id, true);
    if (tab.paneLayout) useWorkspaceStore.setState({ lastClosed: { ...tab, historySnapshot: snapshot } });
    if (active === id) {
      const next = neighbors[neighbors.length - 1];
      if (next) activateCompositionTab(next.id);
      else { useUnifiedWorkspace.setState({ layout: null, activeTabId: '', focused: '' }); useUnifiedWorkspace.getState().openStart(); }
    }
    useWorkspaceNavigation.getState().selectArea('unified');
  };
  const harness = () => {
    const agents = resources.flatMap(resource => resource.kind === 'agent' ? [resource.sessionId] : []);
    if (!force && interceptHarnessClose(agents, complete)) return;
    complete();
  };
  const files = resources.flatMap(resource => resource.kind === 'document' ? [resource.file] : []);
  if (!force && interceptEditorClose(files, harness)) return;
  harness();
}
