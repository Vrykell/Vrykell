/** Follow live output while preserving explicit history navigation and reading anchors. */

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { terminalDebug } from '../services/terminalDebug';
import { blockTerminalFor } from '../services/terminalRepaint';

const BOTTOM_THRESHOLD_PX = 32;
/** A user upward gesture keeps its position past the bottom band until this window lapses. */
const WHEEL_BAND_GUARD_MS = 250;
const SCROLL_IDLE_MS = 120;

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
  const titleBottom = scroll.parentElement?.querySelector<HTMLElement>('.pinned-command')?.getBoundingClientRect().bottom;
  const y = Math.min(viewport.bottom - 8, Math.max(viewport.top + 20, (titleBottom ?? viewport.top) + 8));
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
    let height = el.clientHeight;
    let contentHeight = el.scrollHeight;
    let frame = 0;
    let lastVisibleTop = el.scrollTop;
    let pendingRestoreTop: number | null = null;
    const persist = () => {
      if (height > 0) lastVisibleTop = el.scrollTop;
      if (persistKey) scrollMemory.set(persistKey, { top: lastVisibleTop, following: atBottomRef.current });
    };
    const record = (reason: string) => terminalDebug('terminal-follow-state', { paneId: persistKey, reason, following: atBottomRef.current, top: el.scrollTop, height: el.clientHeight, contentHeight: el.scrollHeight });
    const scheduleSnap = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; if (atBottomRef.current) { snap(); persist(); } });
    };
    let anchor: ViewAnchor | null = null;
    let anchorTimer: ReturnType<typeof setTimeout> | undefined;
    let wheelBandGuardUntil = 0;
    const wheelBandGuarded = () => performance.now() < wheelBandGuardUntil;
    const scheduleAnchor = () => {
      clearTimeout(anchorTimer);
      anchor = null;
      if (atBottomRef.current) return;
      // Hit testing a long text flow forces style and geometry work. Capture the precise
      // reading anchor once a gesture settles, keeping active scrolling on the native path.
      anchorTimer = setTimeout(() => {
        anchorTimer = undefined;
        if (!atBottomRef.current) anchor = captureViewAnchor(el);
      }, SCROLL_IDLE_MS);
    };
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
      if (event.deltaY >= 0) {
        // A downward reversal ends the upward guard so the bottom band re-engages right away.
        wheelBandGuardUntil = 0;
        return;
      }
      if (!(event.target instanceof Element)) return;
      // Any upward gesture over the surface — including ones the live terminal routes into the
      // history at a boundary — must keep its position instead of being snapped back mid-move.
      wheelBandGuardUntil = performance.now() + WHEEL_BAND_GUARD_MS;
      // Keep wheel navigation inside a live terminal's own scrollback or mouse protocol.
      if (event.target.closest('[data-testid="running-term"]')) return;
      if (contentHeight > height) {
        const wasFollowing = atBottomRef.current;
        atBottomRef.current = false;
        snappedTopRef.current = -1;
        scheduleAnchor();
        persist();
        if (wasFollowing) record('wheel-up');
      }
    };
    const onScroll = () => {
      // Resize observation owns dimensions; reading layout here stalls compositor scrolling.
      if (height <= 0) return;
      if (atBottomRef.current && Math.abs(el.scrollTop - snappedTopRef.current) >= 1) {
        const nextHeight = el.scrollHeight;
        if (nextHeight !== contentHeight) {
          contentHeight = nextHeight;
          height = el.clientHeight;
          if (!wheelBandGuarded() && contentHeight - el.scrollTop - height < BOTTOM_THRESHOLD_PX) {
            scheduleSnap();
            return;
          }
        }
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
      if (wheelBandGuarded() && snappedTopRef.current >= 0 && el.scrollTop < snappedTopRef.current - 1) {
        // A guarded upward gesture moved the view above the last snap point: it is reading now.
        atBottomRef.current = false;
        snappedTopRef.current = -1;
      } else if (!wheelBandGuarded()) {
        atBottomRef.current =
          contentHeight - el.scrollTop - height < BOTTOM_THRESHOLD_PX;
      }
      scheduleAnchor();
      persist();
      if (wasFollowing !== atBottomRef.current) record('scroll');
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    el.addEventListener('wheel', onWheel, { capture: true, passive: true });
    // Observe the whole output flow because live xterm height changes outside React.
    const content = el.firstElementChild;
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      if (el.clientHeight <= 0) return;
      if (pendingRestoreTop !== null) {
        el.scrollTop = pendingRestoreTop; pendingRestoreTop = null;
        if (!atBottomRef.current) anchor = captureViewAnchor(el);
      }
      contentHeight = el.scrollHeight;
      // Honor the visible bottom position before restoring an older reading anchor; a fresh
      // upward gesture keeps its position even inside the bottom band.
      if (!wheelBandGuarded()
        && el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD_PX) {
        atBottomRef.current = true;
        anchor = null;
      }
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
      clearTimeout(anchorTimer);
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
    if (persistKey) blockTerminalFor(persistKey)?.scrollToBottom();
    if (persistKey) scrollMemory.delete(persistKey);
    snap();
  }, [snap, persistKey]);
}
