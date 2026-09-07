import { ToolbarBtn } from '@/components/UiBtn';
import { useT } from '@/i18n';
import { PANEL_DEFS } from '@/stores/dock';

interface DockButtonProps {
  panelId: string;
  active: boolean;
  /** mousedown 回调 — TopDock 统一管理 click vs drag */
  onMouseDown?: (e: React.MouseEvent, btnId: string) => void;
}

export default function DockButton({ panelId, active, onMouseDown }: DockButtonProps) {
  const { t } = useT();
  const def = PANEL_DEFS[panelId];
  if (!def) return null;

  const label = t(`dock.${panelId}` as any);
  const action = active ? t('dock.close') : t('dock.open');
  const Icon = def.icon;

  return (
    <ToolbarBtn
      title={`${label} — ${t('dock.dragTip', { action })}`}
      active={active}
      attrs={{
        'data-dock-btn': panelId,
        onMouseDown: (e: React.MouseEvent) => {
          e.preventDefault(); // 阻止 button 原生的 focus/click 行为
          onMouseDown?.(e, panelId);
        },
      }}
    >
      <Icon size={16} />
    </ToolbarBtn>
  );
}
