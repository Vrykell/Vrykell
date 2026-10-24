import { useLayoutEffect, type RefObject } from 'react';
import { useListReorder } from '@ui/layout/listReorder';

/** Retain the whole active tab and its close control when the strip changes width. */
export function useActiveTabVisibility(ref: RefObject<HTMLElement | null>, selector: string, revision: string) {
  useLayoutEffect(() => {
    const strip = ref.current;
    if (!strip) return;
    const reveal = () => {
      const reorder = useListReorder.getState();
      if (reorder.pendingScroll && reorder.pendingScroll.listId === strip.dataset.reorderList) strip.scrollLeft = reorder.pendingScroll.scrollLeft;
      if (strip.clientWidth > 0 && !reorder.drag && !reorder.pending) strip.querySelector(selector)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    };
    reveal();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(reveal);
    observer.observe(strip);
    return () => observer.disconnect();
  }, [ref, selector, revision]);
}
