/** Follow live output while preserving explicit history navigation and reading anchors. */

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { terminalDebug } from '../services/terminalDebug';

const BOTTOM_THRESHOLD_PX = 32;

interface ViewAnchor {
  range: Range | null;
  element: HTMLElement;
  textTop: number | null;
  elementTop: number;
}

function textTop(range: Range | null, scroll: HTMLElement): number | null {
  if (!range?.startContainer.isConnected || !scroll.contains(range.startContainer)) return null;
  const rect = range.getBoundingClientRect();
  return rect.height > 0 ? rect.top : null;
}

function captureViewAnchor(scroll: HTMLElement): ViewAnchor | null {
  const viewport = scroll.getBoundingClientRect();
  if (viewport.width <= 0 || viewport.height <= 0) return null;
  const x = Math.min(viewport.right - 8, viewport.left + 80);
  const y = Math.min(viewport.bottom - 8, viewport.top + 20);
  const target = document.elementFromPoint(x, y);
  if (!target || !scroll.contains(target)) return null;
  const element = target.closest<HTMLElement>('[data-testid^="command-block-"], [data-testid^="running-block-"]')
    ?? target as HTMLElement;
  const caret = document.caretRangeFromPoint?.(x, y);
  const range = caret?.startContainer.nodeType === Node.TEXT_NODE
    && scroll.contains(caret.startContainer) ? caret.cloneRange() : null;
  const caretTop = textTop(range, scroll);
  return {
    range,
    element,
    textTop: caretTop === null ? null : caretTop - viewport.top,
    elementTop: element.getBoundingClientRect().top - viewport.top,
  };
}

const engagers = new Map<string, () => void>();
export function registerFollowEngager(id: string, engage: () => void): () => void {
  engagers.set(id, engage);
  return () => { if (engagers.get(id) === engage) engagers.delete(id); };
}
export function engageFollow(id: string): void { engagers.get(id)?.(); }

interface SavedScroll { top: number; following?: boolean; }
const scrollMemory = new Map<string, SavedScroll>();
export function saveScrollPos(key: string, top: number): void { scrollMemory.set(key, { top }); }

export function useFollowBottom(
  scrollRef: React.RefObject<HTMLDivElement | null>,
  deps: unknown[],
  persistKey?: string,
): () => void {
  const atBottomRef = useRef(true);
  // Retain the actual, clamped offset to recognize delayed programmatic scroll events.
  const snappedTopRef = useRef(-1);

  const snap = useCallback(() => {
    const el = scrollRef.current;
    if (!el || el.clientHeight <= 0) return;
    el.scrollTop = el.scrollHeight;
    snappedTopRef.current = el.scrollTop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let width = el.clientWidth;
    let height = el.clientHeight;
    let contentHeight = el.scrollHeight;
    let frame = 0;
    let lastVisibleTop = el.scrollTop;
    let pendingRestoreTop: number | null = null;
    const persist = () => {
      if (el.clientHeight > 0) lastVisibleTop = el.scrollTop;
      if (persistKey) scrollMemory.set(persistKey, { top: lastVisibleTop, following: atBottomRef.current });
    };
    const record = (reason: string) => terminalDebug('terminal-follow-state', { paneId: persistKey, reason, following: atBottomRef.current, top: el.scrollTop, height: el.clientHeight, contentHeight: el.scrollHeight });
    const scheduleSnap = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; if (atBottomRef.current) { snap(); persist(); } });
    };
    let anchor: ViewAnchor | null = null;
    let restoredTop: number | null = null;
    const restoreAnchor = () => {
      if (!anchor) return;
      if (!anchor.element.isConnected || !el.contains(anchor.element)) {
        anchor = captureViewAnchor(el);
        return;
      }
      const caretTop = textTop(anchor.range, el);
      const viewportTop = el.getBoundingClientRect().top;
      let offset = anchor.element.getBoundingClientRect().top - viewportTop - anchor.elementTop;
      if (caretTop !== null && anchor.textTop !== null) {
        offset = caretTop - viewportTop - anchor.textTop;
      }
      if (Math.abs(offset) < 0.5) return;
      el.scrollTop += offset;
      restoredTop = el.scrollTop;
      if (persistKey) saveScrollPos(persistKey, restoredTop);
    };
    if (persistKey) {
      const saved = scrollMemory.get(persistKey);
      scrollMemory.delete(persistKey);
      if (saved) {
        el.scrollTop = saved.top;
        lastVisibleTop = saved.top;
        if (el.clientHeight <= 0) pendingRestoreTop = saved.top;
        atBottomRef.current = saved.following ?? el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD_PX;
        if (!atBottomRef.current) anchor = captureViewAnchor(el);
        else scheduleSnap();
        record('restore');
      }
    }
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0 && el.scrollHeight > el.clientHeight) {
        atBottomRef.current = false;
        snappedTopRef.current = -1;
        anchor = captureViewAnchor(el);
        persist();
        record('wheel-up');
      }
      // Embedded terminal viewports intercept wheel events even with their scrollbar hidden.
      // Route them to the surrounding history before the inner viewport consumes them.
      if (event.deltaY !== 0 && event.target instanceof Element && event.target.closest('[data-testid="running-term"]')) {
        event.preventDefault();
        event.stopPropagation();
        const unit = event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? el.clientHeight
          : event.deltaMode === WheelEvent.DOM_DELTA_LINE ? parseFloat(getComputedStyle(el).lineHeight) || 16 : 1;
        el.scrollTop += event.deltaY * unit;
        if (!atBottomRef.current) anchor = captureViewAnchor(el);
        persist();
      }
    };
    const onScroll = () => {
      if (el.clientHeight <= 0) return;
      const contentChanged = el.scrollHeight !== contentHeight;
      contentHeight = el.scrollHeight;
      if (el.clientWidth !== width || el.clientHeight !== height || (contentChanged && atBottomRef.current)) {
        // A jump to the bottom may precede its scroll event and a layout resize.
        if (el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD_PX) {
          atBottomRef.current = true;
          anchor = null;
        }
        width = el.clientWidth;
        height = el.clientHeight;
        if (atBottomRef.current) scheduleSnap();
        else restoreAnchor();
        return;
      }
      if (restoredTop !== null && Math.abs(el.scrollTop - restoredTop) < 1) {
        restoredTop = null;
        return;
      }
      restoredTop = null;
      // Fractional offsets and delayed scroll events must not disable live following.
      if (Math.abs(el.scrollTop - snappedTopRef.current) < 1) {
        atBottomRef.current = true;
        anchor = null;
        persist();
        return;
      }
      const wasFollowing = atBottomRef.current;
      atBottomRef.current =
        el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD_PX;
      anchor = atBottomRef.current ? null : captureViewAnchor(el);
      persist();
      if (wasFollowing !== atBottomRef.current) record('scroll');
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    el.addEventListener('wheel', onWheel, { capture: true, passive: false });
    // Observe the whole output flow because live xterm height changes outside React.
    const content = el.firstElementChild;
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      if (el.clientHeight <= 0) return;
      if (pendingRestoreTop !== null) {
        el.scrollTop = pendingRestoreTop; pendingRestoreTop = null;
        if (!atBottomRef.current) anchor = captureViewAnchor(el);
      }
      contentHeight = el.scrollHeight;
      // Honor the visible bottom position before restoring an older reading anchor.
      if (el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD_PX) {
        atBottomRef.current = true;
        anchor = null;
      }
      width = el.clientWidth;
      height = el.clientHeight;
      const previousTop = el.scrollTop;
      if (atBottomRef.current) { snap(); persist(); }
      else restoreAnchor();
      if (Math.abs(el.scrollTop - previousTop) >= 1) terminalDebug('terminal-flow-layout', {
        paneId: persistKey, following: atBottomRef.current, previousTop, top: el.scrollTop,
        contentHeight: el.scrollHeight, height: el.clientHeight,
      });
    });
    ro?.observe(el);
    if (content) ro?.observe(content);
    return () => {
      persist();
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('wheel', onWheel, true);
      cancelAnimationFrame(frame);
      ro?.disconnect();
    };
    // The output host remains attached for the lifetime of this pane.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    // Apply committed history geometry before paint, without a second presentation frame.
    if (atBottomRef.current) snap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return useCallback(() => {
    atBottomRef.current = true;
    if (persistKey) scrollMemory.delete(persistKey);
    snap();
  }, [snap, persistKey]);
}
