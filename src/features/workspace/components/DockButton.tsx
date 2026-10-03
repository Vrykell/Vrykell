import { useT } from '@i18n';
import { PANEL_DEFS } from '@features/workspace';
import { ToolbarBtn } from '@ui/UiBtn';
import type { DragEvent } from 'react';

interface DockButtonProps {
  panelId: string;
  active: boolean;
  onClick?: () => void;
  onDragStart?: (e: DragEvent<HTMLButtonElement>) => void;
  onDragEnd?: () => void;
  onDragOver?: (e: DragEvent<HTMLButtonElement>) => void;
  onDrop?: (e: DragEvent<HTMLButtonElement>) => void;
}

export default function DockButton({ panelId, active, onClick, onDragStart, onDragEnd, onDragOver, onDrop }: DockButtonProps) {
  const { t } = useT();
  const def = PANEL_DEFS[panelId];
  if (!def) return null;

  const label = t(`dock.${panelId}`);
  const action = active ? t('dock.close') : t('dock.open');
  const Icon = def.icon;

  return (
    <ToolbarBtn
      title={`${label} — 点击${action}左侧面板`}
      active={active}
      onClick={onClick}
      attrs={{
        'data-dock-btn': panelId,
        'aria-label': label,
        'aria-pressed': active,
        className: 'activity-button',
        draggable: !!onDragStart,
        onDragStart, onDragEnd, onDragOver, onDrop,
      }}
    >
      <Icon size={16} />
    </ToolbarBtn>
  );
}
