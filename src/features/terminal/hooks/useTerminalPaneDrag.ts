import { useCallback } from 'react';
import { useDockDragStore } from '@features/workspace';

const DRAG_THRESHOLD_PX = 5;
const NON_DRAG_SELECTOR = 'input, textarea, button, a, [contenteditable="true"], .xterm, [data-no-drag], [data-selectable]';

/** Encapsulates a terminal pane's pointer-drag lifecycle as a reusable interaction hook. */
export function useTerminalPaneDrag(terminalId: string, enabled = true) {
  return useCallback((event: React.MouseEvent) => {
    if (!enabled || event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest(NON_DRAG_SELECTOR)) return;

    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    let started = false;

    const onMove = (moveEvent: MouseEvent) => {
      if (started) return;
      if (Math.abs(moveEvent.clientX - startX) < DRAG_THRESHOLD_PX
        && Math.abs(moveEvent.clientY - startY) < DRAG_THRESHOLD_PX) return;
      started = true;
      useDockDragStore.getState().start(terminalId);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [terminalId, enabled]);
}
