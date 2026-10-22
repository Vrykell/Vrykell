import { PANEL_DEFS, useDockStore } from '../stores/dock';
import { useWorkspaceNavigation } from '../stores/navigation';
import { panelPlacementRects } from '../model/navigationPlacement';

/** The visible placement surface is also the complete pointer release target. */
export function panelPlacementRegions(id: string) {
  const body = document.querySelector<HTMLElement>('.workspace-body');
  const middle = document.querySelector<HTMLElement>('[data-testid="workspace-left-dock"]');
  if (!body) return null;
  const bounds = body.getBoundingClientRect();
  const dock = useDockStore.getState();
  const right = panelPlacementRects(bounds, dock.panelWidths[id] ?? PANEL_DEFS[id]?.width ?? 200).right;
  if (!middle) return { right, left: null };
  const navigation = useWorkspaceNavigation.getState();
  const minContent = parseFloat(getComputedStyle(body).getPropertyValue('--workspace-terminal-min-width')) || 360;
  const available = Math.min(400, window.innerWidth - minContent);
  const slot = middle.getBoundingClientRect();
  const width = navigation.collapsed ? Math.min(navigation.sidebarWidth, available < 160 ? window.innerWidth - 40 : available) : slot.width;
  return { right, left: { left: slot.left, top: slot.top, width, height: slot.height } };
}
