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
  onClick?: () => void;
  onPointerDown?: (e: PointerEvent<HTMLButtonElement>) => void;
}

export default function DockButton({ panelId, active, side = 'left', onClick, onPointerDown }: DockButtonProps) {
  const { t } = useT();
  const def = NAVIGATION_DEFS[panelId];
  if (!def) return null;

  const label = t(`dock.${panelId}`);
  const action = active ? t('dock.close') : t('dock.open');
  const Icon = def.icon;

  return (
    <ToolbarBtn
      title={panelId === 'settings' ? `设置（${isMacOS ? '⌘' : 'Ctrl'}+,）；拖动调整位置` : `${label} — ${action}${side === 'left' ? '左' : '右'}侧面板；拖动调整位置`}
      active={active}
      onClick={onClick}
      attrs={{
        'data-dock-btn': panelId,
        'aria-label': label,
        'aria-pressed': active,
        className: panelId === 'settings' ? 'activity-button workspace-settings' : 'activity-button',
        draggable: false,
        onPointerDown,
      }}
    >
      <Icon size={iconSizes.navigation} />
    </ToolbarBtn>
  );
}
