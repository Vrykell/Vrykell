import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MenuItem } from '@ui/UiBtn';
import { clampMenuPosition } from '@ui/menuPosition';

export interface ContextMenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
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

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const frame = requestAnimationFrame(() => document.addEventListener('click', h));
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('click', h);
    };
  }, [onClose]);

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
      {items.map((item, i) => (
        <MenuItem
          key={i}
          label={item.label}
          danger={item.danger}
          onClick={() => { item.onClick(); onClose(); }}
        />
      ))}
    </div>,
    document.body,
  );
}
