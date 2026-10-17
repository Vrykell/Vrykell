import { useLayoutEffect, useState, type RefObject } from 'react';
import { clampMenuPosition } from '../menuPosition';

/** Measure floating content so font changes and narrow windows keep it on screen. */
export function useFloatingPanelPosition(ref: RefObject<HTMLElement | null>, anchor: { x: number; y: number }, submenuOf?: HTMLElement) {
  const [position, setPosition] = useState({ left: anchor.x, top: anchor.y });
  useLayoutEffect(() => {
    const panel = ref.current;
    if (!panel) return;
    let frame = 0;
    const update = () => {
      const bounds = panel.getBoundingClientRect();
      const row = submenuOf?.getBoundingClientRect();
      const left = row ? row.right + bounds.width + 4 <= window.innerWidth - 8 ? row.right + 4 : row.left - bounds.width - 4 : anchor.x;
      const next = clampMenuPosition({ left, top: row ? row.top - 4 : anchor.y }, bounds,
        { width: window.innerWidth, height: window.innerHeight });
      setPosition(previous => previous.left === next.left && previous.top === next.top ? previous : next);
    };
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(panel);
    const resize = () => { update(); cancelAnimationFrame(frame); frame = requestAnimationFrame(update); };
    window.addEventListener('resize', resize);
    window.addEventListener('scroll', update, true);
    return () => { observer?.disconnect(); cancelAnimationFrame(frame); window.removeEventListener('resize', resize); window.removeEventListener('scroll', update, true); };
  }, [ref, anchor.x, anchor.y, submenuOf]);
  return position;
}
