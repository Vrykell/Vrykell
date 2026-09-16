import { useEffect, useRef } from 'react';
import { MenuItem } from '@/components/UiBtn';

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

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    requestAnimationFrame(() => document.addEventListener('click', h));
    return () => document.removeEventListener('click', h);
  }, [onClose]);

  const top = Math.min(anchor.y, window.innerHeight - items.length * 32 - 20);
  const left = Math.min(anchor.x, window.innerWidth - 220);

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        zIndex: 9999,
        top,
        left,
        minWidth: 180,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-inner)',
        boxShadow: 'var(--shadow-md)',
        padding: '4px 0',
        fontSize: 12,
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
    </div>
  );
}
