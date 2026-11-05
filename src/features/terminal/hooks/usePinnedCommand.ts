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
export function measurePinnedCommand(scroll: HTMLElement): PinnedCommand | null {
  const viewport = scroll.getBoundingClientRect();
  if (viewport.height <= 0 || viewport.width <= 0) return null;
  for (const item of scroll.querySelectorAll<HTMLElement>('[data-command-block-id]')) {
    const bounds = item.getBoundingClientRect();
    if (bounds.top >= viewport.top) break;
    if (bounds.bottom <= viewport.top) continue;
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
      apply(measurePinnedCommand(scroll), false);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const onScroll = () => {
      apply(measurePinnedCommand(scroll), true);
      schedule();
    };
    const resize = new ResizeObserver(schedule);
    resize.observe(scroll);
    if (scroll.firstElementChild) resize.observe(scroll.firstElementChild);
    const mutation = new MutationObserver(schedule);
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
