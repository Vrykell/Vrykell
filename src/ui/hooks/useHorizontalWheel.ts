import { useEffect, type RefObject } from 'react';

export function horizontalWheelDelta(event: Pick<WheelEvent, 'ctrlKey' | 'deltaX' | 'deltaY' | 'deltaMode'>, width: number) {
  if (event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return 0;
  return event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? width : 1);
}
export function useHorizontalWheel(ref: RefObject<HTMLElement | null>, visible: boolean) {
  useEffect(() => {
    const element = ref.current;
    if (!element || !visible) return;
    const wheel = (event: WheelEvent) => {
      const delta = horizontalWheelDelta(event, element.clientWidth);
      const next = Math.max(0, Math.min(element.scrollWidth - element.clientWidth, element.scrollLeft + delta));
      if (delta && next !== element.scrollLeft) { event.preventDefault(); element.scrollLeft = next; }
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [ref, visible]);
}
