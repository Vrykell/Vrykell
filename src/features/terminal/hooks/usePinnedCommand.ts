import { useEffect, useRef, useState, type RefObject } from 'react';
import { flushSync } from 'react-dom';

export interface PinnedCommand { id: string; remaining: number }

/**
 * Select the command whose output crosses the top edge.
 *
 * A completed command keeps scrolling away until its command line has left view, then shows the
 * compact copy. A running status row is a toolbar: it pins as soon as its top edge crosses, so
 * the controls are never painted cut in half while the row waits to leave completely.
 */
export function measurePinnedCommand(scroll: HTMLElement, blocks?: NodeListOf<HTMLElement>): PinnedCommand | null {
  const viewport = scroll.getBoundingClientRect();
  if (viewport.height <= 0 || viewport.width <= 0) return null;
  const items = blocks ?? scroll.querySelectorAll<HTMLElement>('[data-command-block-id]');
  let low = 0;
  let high = items.length;
  // Blocks follow document order. Find the first whose bottom crosses the viewport.
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (items[mid]!.getBoundingClientRect().bottom <= viewport.top) low = mid + 1;
    else high = mid;
  }
  const item = items[low];
  if (item) {
    const bounds = item.getBoundingClientRect();
    if (bounds.top >= viewport.top) return null;
    const running = item.dataset.running === 'true';
    const title = item.querySelector<HTMLElement>(running ? '.command-block-info' : '.command-block-command');
    if (!title) return null;
    const titleBounds = title.getBoundingClientRect();
    if (running ? titleBounds.top >= viewport.top : titleBounds.bottom > viewport.top) return null;
    return { id: item.dataset.commandBlockId!, remaining: bounds.bottom - viewport.top };
  }
  return null;
}

/** Batch scroll and layout changes without inserting anything into the reading flow. */
export function usePinnedCommand(scrollRef: RefObject<HTMLDivElement | null>) {
  const [pinned, setPinned] = useState<PinnedCommand | null>(null);
  const currentRef = useRef<PinnedCommand | null>(null);
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const readBlocks = () => scroll.querySelectorAll<HTMLElement>('[data-command-block-id]');
    let blocks = readBlocks();
    let frame = 0;
    const apply = (next: PinnedCommand | null, immediate: boolean) => {
      const previous = currentRef.current;
      if (previous?.id === next?.id && previous?.remaining === next?.remaining) return;
      const presenceChanged = (previous === null) !== (next === null);
      currentRef.current = next;
      // A header that appears or leaves must land in the scrolled frame. Deferring it by one
      // frame leaves the original toolbar painted cut in half at the viewport edge.
      if (immediate && presenceChanged) flushSync(() => setPinned(next));
      else setPinned(next);
    };
    const measure = () => {
      frame = 0;
      apply(measurePinnedCommand(scroll, blocks), false);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      apply(measurePinnedCommand(scroll, blocks), true);
    };
    const resize = new ResizeObserver(schedule);
    resize.observe(scroll);
    if (scroll.firstElementChild) resize.observe(scroll.firstElementChild);
    const mutation = new MutationObserver(records => {
      // Terminal row repaints do not change the ordered history block membership.
      if (!records.some(record => record.target === scroll.firstElementChild)) return;
      blocks = readBlocks();
      schedule();
    });
    mutation.observe(scroll, { subtree: true, childList: true });
    scroll.addEventListener('scroll', onScroll, { passive: true });
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutation.disconnect();
      scroll.removeEventListener('scroll', onScroll);
    };
  }, [scrollRef]);
  return pinned;
}
