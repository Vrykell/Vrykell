import { useTerminalStore } from '../stores/terminal';
import { useDockDragStore, useSessionStore, useUiStore, useWorkspaceNavigation } from '@features/workspace';
import { leaves } from '@features/workspace/model/windowLayout';

export function useManualFullscreenVisible(paneId: string): boolean {
  const requested = useTerminalStore(state => !!state.manualFullscreen[paneId]);
  const focused = useTerminalStore(state => state.focusedPaneId === paneId);
  const activePane = useSessionStore(state => {
    const tab = state.tabs.find(item => item.id === state.activeId);
    return tab?.kind === 'session' && leaves(tab.layout).some(pane => pane.id === paneId);
  });
  const terminalArea = useWorkspaceNavigation(state => state.area === 'terminal' || state.area === 'unified');
  const blocked = useUiStore(state => state.settingsOpen || state.splitPlacement.open || state.movePlacement.open || state.splitPickerOpen);
  const dragging = useDockDragStore(state => state.draggingTerminalId !== null);
  return requested && focused && activePane && terminalArea && !blocked && !dragging;
}
