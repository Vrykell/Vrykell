import { useLayoutEffect, useState, type RefObject } from 'react';
import { clampMenuPosition } from '@ui/menus/menuPosition';

/** Measure floating content so font changes and narrow windows keep it on screen. */
export function useFloatingPanelPosition(ref: RefObject<HTMLElement | null>, anchor: { x: number; y: number; above?: HTMLElement; aboveY?: number; trigger?: HTMLElement; align?: 'start' | 'end' }, submenuOf?: HTMLElement, enabled = true) {
  const [position, setPosition] = useState<{ left: number; top: number; maxHeight?: number }>({ left: anchor.x, top: anchor.y });
  useLayoutEffect(() => {
    const panel = ref.current;
    if (!panel || !enabled) return;
    let frame = 0;
    const update = () => {
      const bounds = panel.getBoundingClientRect();
      const row = submenuOf?.getBoundingClientRect();
      const trigger = anchor.align === 'end' && anchor.trigger?.isConnected ? anchor.trigger.getBoundingClientRect() : undefined;
      const left = row ? row.right + bounds.width + 4 <= window.innerWidth - 8 ? row.right + 4 : row.left - bounds.width - 4
        : anchor.align === 'end' ? (trigger?.right ?? anchor.x) - bounds.width : anchor.x;
      const aboveY = anchor.above?.isConnected ? anchor.above.getBoundingClientRect().top : anchor.aboveY;
      const bottom = aboveY !== undefined ? Math.max(8, aboveY - 6) : window.innerHeight - 8;
      const maxHeight = aboveY !== undefined ? Math.max(0, bottom - 8) : undefined;
      const height = Math.min(bounds.height, maxHeight ?? bounds.height);
      const next = { ...clampMenuPosition({ left, top: row ? row.top - 4 : aboveY !== undefined ? bottom - height : trigger ? trigger.bottom + 4 : anchor.y }, { ...bounds, width: bounds.width, height },
        { width: window.innerWidth, height: bottom + 8 }), maxHeight };
      setPosition(previous => previous.left === next.left && previous.top === next.top && previous.maxHeight === next.maxHeight ? previous : next);
    };
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(panel);
    const resize = () => { update(); cancelAnimationFrame(frame); frame = requestAnimationFrame(update); };
    window.addEventListener('resize', resize);
    window.addEventListener('scroll', update, true);
    return () => { observer?.disconnect(); cancelAnimationFrame(frame); window.removeEventListener('resize', resize); window.removeEventListener('scroll', update, true); };
  }, [ref, anchor.x, anchor.y, anchor.above, anchor.aboveY, anchor.trigger, anchor.align, submenuOf, enabled]);
  return position;
}
