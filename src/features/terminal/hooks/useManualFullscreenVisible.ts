import { useTerminalStore } from '../stores/terminal';
import { useDockDragStore, useSessionStore, useUiStore, useUnifiedWorkspace, useWorkspaceNavigation } from '@features/workspace';
import { leaves } from '@features/workspace/model/windowLayout';
import { workspacePaneCells } from '@features/workspace/model/workspaceResources';
import { useWorkspacePlacementActive } from '@features/workspace/hooks/useWorkspaceContainer';

export function useManualFullscreenVisible(paneId: string): boolean {
  const requested = useTerminalStore(state => !!state.manualFullscreen[paneId]);
  const focused = useTerminalStore(state => state.focusedPaneId === paneId);
  const activePane = useSessionStore(state => {
    const tab = state.tabs.find(item => item.id === state.activeId);
    return tab?.kind === 'session' && leaves(tab.layout).some(pane => pane.id === paneId);
  });
  const placed = useUnifiedWorkspace(state => !!state.layout && workspacePaneCells(state.layout)
    .some(cell => cell.resourceId === `terminal:${paneId}`));
  const area = useWorkspaceNavigation(state => state.area);
  const terminalArea = area === 'terminal' || area === 'unified';
  const placing = useWorkspacePlacementActive(area === 'unified' ? 'unified' : 'terminal');
  const blocked = useUiStore(state => state.settingsOpen || state.splitPlacement.open || state.movePlacement.open || state.splitPickerOpen);
  const dragging = useDockDragStore(state => state.draggingTerminalId !== null);
  return requested && focused && (area === 'unified' ? placed : activePane) && terminalArea && !blocked && !dragging && !placing;
}
