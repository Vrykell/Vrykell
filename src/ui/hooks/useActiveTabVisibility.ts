import { useEffect, type RefObject } from 'react';
import { useListReorder } from '../listReorder';

/** Retain the whole active tab and its close control when the strip changes width. */
export function useActiveTabVisibility(ref: RefObject<HTMLElement | null>, selector: string, revision: string) {
  useEffect(() => {
    const strip = ref.current;
    if (!strip) return;
    const reveal = () => {
      if (strip.clientWidth > 0 && !useListReorder.getState().drag) strip.querySelector(selector)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    };
    reveal();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(reveal);
    observer.observe(strip);
    return () => observer.disconnect();
  }, [ref, selector, revision]);
}
