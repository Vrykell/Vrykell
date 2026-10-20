import { useEffect, useState, type RefObject } from 'react';

export interface PinnedCommand { id: string; remaining: number }

/** Select the command whose output crosses the top edge, after its title has left view. */
export function measurePinnedCommand(scroll: HTMLElement): PinnedCommand | null {
  const viewport = scroll.getBoundingClientRect();
  if (viewport.height <= 0 || viewport.width <= 0) return null;
  for (const item of scroll.querySelectorAll<HTMLElement>('[data-command-block-id]')) {
    const bounds = item.getBoundingClientRect();
    if (bounds.top >= viewport.top) break;
    if (bounds.bottom <= viewport.top) continue;
    const title = item.querySelector<HTMLElement>(item.dataset.running === 'true' ? '.command-block-info' : '.command-block-command');
    if (!title || title.getBoundingClientRect().bottom > viewport.top) return null;
    return { id: item.dataset.commandBlockId!, remaining: bounds.bottom - viewport.top };
  }
  return null;
}

/** Batch scroll and layout changes without inserting anything into the reading flow. */
export function usePinnedCommand(scrollRef: RefObject<HTMLDivElement | null>) {
  const [pinned, setPinned] = useState<PinnedCommand | null>(null);
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const next = measurePinnedCommand(scroll);
      setPinned(previous => previous?.id === next?.id && previous?.remaining === next?.remaining ? previous : next);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const resize = new ResizeObserver(schedule);
    resize.observe(scroll);
    if (scroll.firstElementChild) resize.observe(scroll.firstElementChild);
    const mutation = new MutationObserver(schedule);
    mutation.observe(scroll, { subtree: true, childList: true });
    scroll.addEventListener('scroll', schedule, { passive: true });
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutation.disconnect();
      scroll.removeEventListener('scroll', schedule);
    };
  }, [scrollRef]);
  return pinned;
}
