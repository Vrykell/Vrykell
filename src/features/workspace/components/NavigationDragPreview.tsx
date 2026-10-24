import { createPortal } from 'react-dom';
import { t } from '@i18n';
import { NAVIGATION_DEFS, useNavigationDrag } from '@features/workspace';
import { iconSizes } from '@ui/icons';
import { panelPlacementRegions } from '../services/panelPlacementRegions';
import DropPlacementPreview from '@ui/layout/DropPlacementPreview';

/** The dragged action follows the pointer without obscuring insertion hit testing. */
export default function NavigationDragPreview() {
  const id = useNavigationDrag(state => state.id);
  const position = useNavigationDrag(state => state.position);
  const target = useNavigationDrag(state => state.target);
  const Icon = id ? NAVIGATION_DEFS[id]?.icon : undefined;
  if (!Icon || !position) return null;
  const regions = panelPlacementRegions(id!);
  const region = target && regions?.[target.side];
  return createPortal(
    <>
      {target?.openPanel && region && <DropPlacementPreview className="workspace-panel-drop-preview" data-testid="panel-drop-preview" data-side={target.side}
        style={region}>
        <Icon size={iconSizes.navigation} /><span>{t('Release to open {{panel}}', { panel: NAVIGATION_DEFS[id!].label })}</span>
      </DropPlacementPreview>}
    {!target?.openPanel && <div className="workspace-navigation-drag-preview" aria-hidden="true" style={{ left: position.x, top: position.y }}>
      <Icon size={iconSizes.navigation} />
    </div>}</>, document.body,
  );
}
