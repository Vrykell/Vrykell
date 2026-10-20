import { iconSizes } from '@ui/icons';
import { useT } from '@i18n';
import { NAVIGATION_DEFS, type DockSide } from '@features/workspace';
import { ToolbarBtn } from '@ui/UiBtn';
import type { PointerEvent } from 'react';
import { isMacOS } from '@platform/runtime';

interface DockButtonProps {
  panelId: string;
  active: boolean;
  side?: DockSide;
  /** Fixed actions sit outside the draggable zones and cannot be reordered. */
  fixed?: boolean;
  onClick?: () => void;
  onPointerDown?: (e: PointerEvent<HTMLButtonElement>) => void;
}

export default function DockButton({ panelId, active, fixed = false, onClick, onPointerDown }: DockButtonProps) {
  const { t } = useT();
  const def = NAVIGATION_DEFS[panelId];
  if (!def) return null;

  const label = t(`dock.${panelId}`);
  const action = active ? t('dock.close') : t('dock.open');
  const Icon = def.icon;

  return (
    <ToolbarBtn
      title={panelId === 'settings' ? t('Open settings') : t('{{action}} {{panel}}', { action, panel: label })}
      active={active}
      onClick={onClick}
      attrs={{
        'data-dock-btn': panelId,
        'data-tip-shortcut': panelId === 'settings' ? `${isMacOS ? 'Meta' : 'Control'}+,` : undefined,
        'aria-label': label,
        'aria-pressed': active,
        'data-dock-fixed': fixed ? 'true' : undefined,
        className: panelId === 'settings' ? 'activity-button workspace-settings' : 'activity-button',
        draggable: false,
        onPointerDown,
      }}
    >
      <Icon size={iconSizes.navigation} />
    </ToolbarBtn>
  );
}
