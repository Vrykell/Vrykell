import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

/** Newline count drives the box height; a manual scan avoids allocating an array on every key. */
function lineCount(value: string): number {
  let count = 1;
  for (let index = 0; index < value.length; index++) {
    if (value.charCodeAt(index) === 10) count += 1;
  }
  return count;
}

/** Recompute text and placeholder wrapping after content, width or typography changes. */
export function useAutoSizeTextarea(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
  maxHeight = 120,
  enabled = true,
) {
  const frame = useRef(0);
  const lines = useRef<number | null>(null);
  const active = useRef(enabled);
  active.current = enabled;
  const resize = useCallback(() => {
    const element = ref.current;
    if (!element || element.clientWidth <= 0) return;
    element.style.overflowY = 'hidden';
    element.style.height = 'auto';
    const css = getComputedStyle(element);
    const pixels = (value: string) => Number.parseFloat(value) || 0;
    const height = element.scrollHeight + (css.boxSizing === 'border-box'
      ? pixels(css.borderTopWidth) + pixels(css.borderBottomWidth)
      : -pixels(css.paddingTop) - pixels(css.paddingBottom));
    const limit = css.maxHeight.endsWith('px') ? Math.min(maxHeight, pixels(css.maxHeight)) : maxHeight;
    element.style.height = `${Math.min(height, limit)}px`;
    element.style.overflowY = height > limit ? 'auto' : 'hidden';
  }, [ref, maxHeight]);

  useLayoutEffect(() => {
    if (!enabled) return;
    const nextLines = lineCount(value);
    if (lines.current === null || lines.current !== nextLines) {
      // A new line changes the box immediately; a plain keystroke measures once per frame instead
      // of inside the key event, so holding a key never queues a synchronous layout per character.
      lines.current = nextLines;
      if (frame.current) { cancelAnimationFrame(frame.current); frame.current = 0; }
      resize();
      return;
    }
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      if (active.current) resize();
    });
  }, [resize, value, enabled]);

  useEffect(() => () => { if (frame.current) cancelAnimationFrame(frame.current); }, []);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!enabled || !element) return;
    let width = element.clientWidth;
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      if (element.clientWidth === width) return;
      resize();
      // Height and scrollbar changes must not create a resize feedback loop.
      width = element.clientWidth;
    });
    observer?.observe(element);
    const mutations = new MutationObserver(resize);
    mutations.observe(element, { attributes: true, attributeFilter: ['placeholder'] });
    mutations.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] });
    return () => { observer?.disconnect(); mutations.disconnect(); };
  }, [ref, resize, enabled]);
}
