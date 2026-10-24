import { iconSizes } from '@ui/icons';
import { useT } from '@i18n';
import { NAVIGATION_DEFS, type DockSide } from '@features/workspace';
import { ToolbarBtn } from '@ui/actions/UiBtn';
import SidebarItem from '@ui/layout/sidebarItem';
import type { PointerEvent } from 'react';
import { isMacOS } from '@platform/runtime';
import AiSessionIcon from '@features/chat/components/AiSessionIcon';

interface DockButtonProps {
  panelId: string;
  active: boolean;
  side?: DockSide;
  /** Fixed actions sit outside the draggable zones and cannot be reordered. */
  fixed?: boolean;
  onClick?: () => void;
  onPointerDown?: (e: PointerEvent<HTMLElement>) => void;
}

export default function DockButton({ panelId, active, side, fixed = false, onClick, onPointerDown }: DockButtonProps) {
  const { t } = useT();
  const def = NAVIGATION_DEFS[panelId];
  if (!def) return null;

  const label = t(`dock.${panelId}`);
  const action = active ? t('dock.close') : t('dock.open');
  const Icon = panelId === 'chat' ? AiSessionIcon : def.icon;
  const accessibleLabel = panelId === 'settings' ? t(active ? 'Close settings' : 'Open settings') : t('{{action}} {{panel}}', { action, panel: label });

  if (side === 'left') {
    return <SidebarItem compact title={label} icon={<Icon size={iconSizes.row} />} active={active}
      tooltip={accessibleLabel} testId={`dock-${panelId}`} tabIndex={0}
      dataAttributes={{
        'data-dock-btn': panelId,
        'data-dock-fixed': fixed ? 'true' : undefined,
        role: 'button',
        'aria-label': label,
        'aria-pressed': String(active),
      }}
      onClick={onClick} onPointerDown={onPointerDown}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick?.();
        }
      }} />;
  }

  return (
    <ToolbarBtn
      title={accessibleLabel}
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
