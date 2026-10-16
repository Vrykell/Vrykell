import { useLayoutEffect, useState, type RefObject } from 'react';
import { clampMenuPosition } from '../menuPosition';

/** Measure floating content so font changes and narrow windows keep it on screen. */
export function useFloatingPanelPosition(ref: RefObject<HTMLElement | null>, anchor: { x: number; y: number }) {
  const [position, setPosition] = useState({ left: anchor.x, top: anchor.y });
  useLayoutEffect(() => {
    const panel = ref.current;
    if (!panel) return;
    const update = () => {
      const bounds = panel.getBoundingClientRect();
      const next = clampMenuPosition({ left: anchor.x, top: anchor.y }, bounds,
        { width: window.innerWidth, height: window.innerHeight });
      setPosition(previous => previous.left === next.left && previous.top === next.top ? previous : next);
    };
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(panel);
    window.addEventListener('resize', update);
    return () => { observer?.disconnect(); window.removeEventListener('resize', update); };
  }, [ref, anchor.x, anchor.y]);
  return position;
}
