import KeyHint from './KeyHint';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * TooltipLayer — one themed hover hint for the whole app.
 *
 * Controls carry their hint in `data-tip` (the native `title` attribute renders in the OS's own
 * style, which clashes with the terminal surface). This layer listens once at the document,
 * shows the hint after a short delay and keeps it inside the viewport.
 */

/** Hover delay before the hint appears (comparable to a native tooltip). */
const SHOW_DELAY_MS = 300;
/** Gap between the trigger and the hint. */
const GAP_PX = 6;
/** Keeps the hint clear of the viewport edges. */
const EDGE_PX = 6;

interface Hint {
  text: string;
  description?: string;
  shortcut?: string;
  rect: { top: number; bottom: number; left: number; width: number };
}

/** Whether a hovered element still wants its hint shown. */
function titleHolder(node: EventTarget | null): HTMLElement | null {
  if (!(node instanceof Element)) return null;
  const holder = node.closest<HTMLElement>('[data-tip]');
  const text = holder?.dataset.tip?.trim();
  return holder && text ? holder : null;
}

export default function TooltipLayer() {
  const [hint, setHint] = useState<Hint | null>(null);
  const [placement, setPlacement] = useState<{ top: number; left: number } | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const ownerRef = useRef<HTMLElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const hide = useCallback(() => {
    clearTimer();
    ownerRef.current = null;
    setHint(null);
    setPlacement(null);
  }, [clearTimer]);

  useEffect(() => {
    const show = () => {
      const owner = ownerRef.current;
      if (!owner) return;
      const rect = owner.getBoundingClientRect();
      setPlacement(null);
      setHint({
        text: owner.dataset.tip ?? '',
        description: owner.dataset.tipDescription,
        shortcut: owner.dataset.tipShortcut,
        rect: { top: rect.top, bottom: rect.bottom, left: rect.left, width: rect.width },
      });
    };

    const onOver = (event: Event) => {
      if (document.querySelector('[data-reorder-dragging="true"]')) return;
      const holder = titleHolder(event.target);
      if (!holder || holder === ownerRef.current) return;
      clearTimer();
      ownerRef.current = holder;
      const text = holder.dataset.tip ?? '';
      if (!text) return;
      timerRef.current = setTimeout(show, SHOW_DELAY_MS);
    };

    const onOut = (event: Event) => {
      const owner = ownerRef.current;
      if (!owner) return;
      const next = (event as MouseEvent).relatedTarget;
      if (next instanceof Node && owner.contains(next)) return;
      hide();
    };

    const onFocusIn = (event: Event) => {
      const holder = titleHolder(event.target);
      // Keyboard focus only: a pointer click must not pop a hint.
      if (!holder || !holder.matches(':focus-visible')) return;
      onOver(event);
    };

    document.addEventListener('mouseover', onOver, true);
    document.addEventListener('mouseout', onOut, true);
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('focusout', hide, true);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
    window.addEventListener('list-reorder-start', hide);
    return () => {
      document.removeEventListener('mouseover', onOver, true);
      document.removeEventListener('mouseout', onOut, true);
      document.removeEventListener('focusin', onFocusIn, true);
      document.removeEventListener('focusout', hide, true);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('blur', hide);
      window.removeEventListener('list-reorder-start', hide);
      clearTimer();
    };
  }, [clearTimer, hide]);

  // Measure the bubble once it exists so the placement can stay inside the viewport.
  useLayoutEffect(() => {
    if (!hint || placement || !bubbleRef.current) return;
    const bubble = bubbleRef.current.getBoundingClientRect();
    const aboveTop = hint.rect.top - GAP_PX - bubble.height;
    const belowTop = hint.rect.bottom + GAP_PX;
    const aboveFits = aboveTop >= EDGE_PX;
    const belowFits = belowTop + bubble.height <= window.innerHeight - EDGE_PX;
    const above = aboveFits || (!belowFits && hint.rect.top > window.innerHeight - hint.rect.bottom);
    const maxLeft = window.innerWidth - EDGE_PX - bubble.width;
    const left = Math.max(EDGE_PX, Math.min(hint.rect.left + hint.rect.width / 2 - bubble.width / 2, maxLeft));
    const maxTop = Math.max(EDGE_PX, window.innerHeight - EDGE_PX - bubble.height);
    const top = Math.max(EDGE_PX, Math.min(above ? aboveTop : belowTop, maxTop));
    setPlacement({ top, left });
  }, [hint, placement]);

  if (!hint) return null;

  return createPortal(
    <div
      ref={bubbleRef}
      className="app-tooltip"
      data-testid="app-tooltip"
      aria-hidden="true"
      style={{
        top: placement ? placement.top : hint.rect.top,
        left: placement ? placement.left : hint.rect.left,
        visibility: placement ? 'visible' : 'hidden',
      }}
    >
      <span className="app-tooltip-copy"><span>{hint.text}</span>{hint.description && <small>{hint.description}</small>}</span>
      {hint.shortcut && <KeyHint shortcut={hint.shortcut} />}
    </div>,
    document.body,
  );
}
