import { createPortal } from 'react-dom';
import { t } from '@i18n';
import { useDockStore, PANEL_DEFS, NAVIGATION_DEFS, useNavigationDrag } from '@features/workspace';
import { iconSizes } from '@ui/icons';
import { panelPlacementRects } from '../model/navigationPlacement';
import DropPlacementPreview from '@ui/DropPlacementPreview';

/** The dragged action follows the pointer without obscuring insertion hit testing. */
export default function NavigationDragPreview() {
  const id = useNavigationDrag(state => state.id);
  const position = useNavigationDrag(state => state.position);
  const target = useNavigationDrag(state => state.target);
  const widths = useDockStore(state => state.panelWidths);
  const Icon = id ? NAVIGATION_DEFS[id]?.icon : undefined;
  if (!Icon || !position) return null;
  const body = document.querySelector<HTMLElement>('.workspace-body')?.getBoundingClientRect();
  const regions = body && panelPlacementRects(body, widths[id!] ?? PANEL_DEFS[id!]?.width ?? 200);
  return createPortal(
    <>
      {target?.openPanel && regions && <DropPlacementPreview className="workspace-panel-drop-preview" data-testid="panel-drop-preview" data-side={target.side}
        style={regions[target.side]}>
        <Icon size={iconSizes.navigation} /><span>{t('Release to open {{panel}}', { panel: NAVIGATION_DEFS[id!].label })}</span>
      </DropPlacementPreview>}
    {!target?.openPanel && <div className="workspace-navigation-drag-preview" aria-hidden="true" style={{ left: position.x, top: position.y }}>
      <Icon size={iconSizes.navigation} />
    </div>}</>, document.body,
  );
}
