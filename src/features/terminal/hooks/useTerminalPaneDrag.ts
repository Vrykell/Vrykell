import { useCallback } from 'react';
import { useDockDragStore } from '@shared/ui';

const DRAG_THRESHOLD_PX = 5;
const NON_DRAG_SELECTOR = 'input, textarea, button, a, [contenteditable="true"], .xterm, [data-no-drag], [data-selectable]';

/** 将终端 Pane 的鼠标拖动生命周期收敛为可复用的交互 Hook。 */
export function useTerminalPaneDrag(terminalId: string) {
  return useCallback((event: React.MouseEvent) => {
    if (event.button !== 0) return;
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
  }, [terminalId]);
}
