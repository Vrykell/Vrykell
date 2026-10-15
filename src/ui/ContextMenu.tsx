import { Fragment } from 'react';
import { menuGroup, orderMenuItems, type MenuGroup } from './menuGroups';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MenuItem } from '@ui/UiBtn';
import { clampMenuPosition } from '@ui/menuPosition';
import { useExclusiveMenu } from './hooks/useExclusiveMenu';

export interface ContextMenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
  group?: MenuGroup;
  order?: number;
  /** Optional shortcut badge displayed at the end of the row. */
  shortcut?: string;
  /** Radio/switch state; renders a leading mark and exposes menuitemradio semantics. */
  checked?: boolean;
}

interface Props {
  /** 菜单位置（相对于 viewport） */
  anchor: { x: number; y: number };
  items: ContextMenuItem[];
  onClose: () => void;
}

/**
 * ContextMenu — 通用右键菜单。
 * 复用 BlockMenu 的 position:fixed + DOMRect anchor 模式。
 */
export default function ContextMenu({ anchor, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useExclusiveMenu(ref, onClose);
  const [position, setPosition] = useState({ left: anchor.x, top: anchor.y });

  useLayoutEffect(() => {
    const updatePosition = () => {
      const menu = ref.current;
      if (!menu) return;
      const rect = menu.getBoundingClientRect();
      setPosition(clampMenuPosition(
        { left: anchor.x, top: anchor.y },
        { width: rect.width, height: rect.height },
        { width: window.innerWidth, height: window.innerHeight },
      ));
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    return () => window.removeEventListener('resize', updatePosition);
  }, [anchor.x, anchor.y, items.length]);

  // Esc 关闭（捕获阶段：不再触发全局 Esc，例如终端键盘目标切换）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label="操作菜单"
      className="workspace-floating"
      onContextMenu={event => { event.preventDefault(); event.stopPropagation(); }}
      style={{
        position: 'fixed',
        zIndex: 9999,
        top: position.top,
        left: position.left,
        minWidth: 'min(180px, calc(100vw - 16px))',
        maxWidth: 'calc(100vw - 16px)',
        boxSizing: 'border-box',
        padding: 4,
        fontSize: 'calc(12px * var(--ui-font-scale))',
      }}
    >
      <ContextMenuItems items={items} onClose={onClose} />
    </div>,
    document.body,
  );
}

/** All action menus share ordering, group boundaries and row controls. */
export function ContextMenuItems({ items, onClose, itemRole }: { items: ContextMenuItem[]; onClose: () => void; itemRole?: 'menuitem' }) {
  const ordered = orderMenuItems(items);
  // Menus that show radio marks keep one mark column so every label starts at the same x.
  const indent = ordered.some((item) => item.checked !== undefined);
  return <>{ordered.map((item, index) => <Fragment key={`${menuGroup(item)}-${item.label}`}>
    {index > 0 && menuGroup(item) !== menuGroup(ordered[index - 1]!) && <div role="separator" className="context-menu-separator" />}
    <MenuItem role={itemRole} label={item.label} danger={item.danger} shortcut={item.shortcut} checked={item.checked} indent={indent} onClick={() => { item.onClick(); onClose(); }} />
  </Fragment>)}</>;
}
