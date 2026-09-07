import { useEffect, useRef } from 'react';
import { MenuItem } from '@/components/UiBtn';
import s from './ContextMenu.module.css';

export interface ContextMenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
}

interface Props {
  anchor: { x: number; y: number };
  items: ContextMenuItem[];
  onClose: () => void;
}

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
    <div ref={ref} className={s.menu} style={{ top, left, minWidth: 180, fontSize: 12 }}>
      {items.map((item, i) => (
        <MenuItem
          key={i}
          label={item.label}
          danger={item.danger}
          onClick={() => {
            item.onClick();
            onClose();
          }}
        />
      ))}
    </div>
  );
}
