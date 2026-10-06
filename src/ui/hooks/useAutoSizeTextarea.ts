import { useCallback, useLayoutEffect, type RefObject } from 'react';

/** Recompute text and placeholder wrapping after content, width or typography changes. */
export function useAutoSizeTextarea(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
  maxHeight = 120,
  enabled = true,
) {
  const resize = useCallback(() => {
    const element = ref.current;
    if (!element || element.clientWidth <= 0) return;
    element.style.overflowY = 'hidden';
    element.style.height = 'auto';
    const height = element.scrollHeight;
    element.style.height = `${Math.min(height, maxHeight)}px`;
    element.style.overflowY = height > maxHeight ? 'auto' : 'hidden';
  }, [ref, maxHeight]);

  useLayoutEffect(() => {
    if (enabled) resize();
  }, [resize, value, enabled]);

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
