import { createPortal } from 'react-dom';
import { NAVIGATION_DEFS, useNavigationDrag } from '@features/workspace';
import { iconSizes } from '@ui/icons';

/** The dragged action follows the pointer without obscuring insertion hit testing. */
export default function NavigationDragPreview() {
  const id = useNavigationDrag(state => state.id);
  const position = useNavigationDrag(state => state.position);
  const Icon = id ? NAVIGATION_DEFS[id]?.icon : undefined;
  if (!Icon || !position) return null;
  return createPortal(
    <div className="workspace-navigation-drag-preview" aria-hidden="true" style={{ left: position.x, top: position.y }}>
      <Icon size={iconSizes.navigation} />
    </div>, document.body,
  );
}
