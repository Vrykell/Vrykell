import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { startDrag, type DragResult } from '@crabnebula/tauri-plugin-drag';
import { useFileDragStore, type FileDragItem, type FileDropTarget } from '@features/files/stores/fileDrag';

/** Drag threshold (matches navigation dragging): below this the gesture stays a click. */
const DRAG_THRESHOLD_PX = 6;

/** How far the pointer must leave the window before the OS owns the drag. */
const NATIVE_DRAG_MARGIN_PX = 8;

/** Drop target under the pointer: a folder row / file row (its sibling directory) or a breadcrumb. */
function locateDropTarget(x: number, y: number): FileDropTarget | null {
  const hit = document.elementFromPoint(x, y);
  const zone = hit?.closest<HTMLElement>('[data-drop-dir]');
  const dir = zone?.dataset.dropDir;
  if (!zone || !dir) return null;
  return { rowPath: zone.dataset.path ?? null, dir };
}

function isOutsideWindow(x: number, y: number): boolean {
  return x <= -NATIVE_DRAG_MARGIN_PX || y <= -NATIVE_DRAG_MARGIN_PX
    || x >= window.innerWidth + NATIVE_DRAG_MARGIN_PX
    || y >= window.innerHeight + NATIVE_DRAG_MARGIN_PX;
}

/** Payload handed to the OS drag: local paths plus the drop effect (local = move; remote = download then copy out). */
export interface NativeDragPayload {
  paths: string[];
  mode: 'copy' | 'move';
}

export interface FileRowDragOptions {
  onDrop: (items: FileDragItem[], target: FileDropTarget) => void;
  /** Prepare local paths before the OS drag (remote entries download first); null cancels the drag-out. */
  prepareNativeDrag?: (items: FileDragItem[]) => Promise<NativeDragPayload | null> | NativeDragPayload | null;
  /**
   * Called when the OS drag ends: `payload.paths` are the local paths handed to the OS (remote = the
   * downloaded copies). On `Dropped` the caller clears the source with move semantics; on `Cancelled`
   * the remote panel discards the temporary copies.
   */
  onNativeDragEnd?: (result: DragResult, items: FileDragItem[], payload: NativeDragPayload) => void;
}

/** Drag out of the window: hand the drag to the OS (desktop / file manager) and refresh the panel afterwards. */
function beginNativeDrag(payload: NativeDragPayload, onEnd?: (result: DragResult) => void) {
  if (!('__TAURI_INTERNALS__' in window)) return;
  // Leave the preview empty: a failed read means "no custom drag image" (Windows falls back to its default).
  void startDrag({ item: payload.paths, icon: '', mode: payload.mode }, (event) => {
    onEnd?.(event.result);
  })
    .catch(() => { onEnd?.('Cancelled'); });
}

/**
 * Row dragging: holding a row and dragging onto a folder / file (sibling directory) / breadcrumb moves it
 * (dragging only moves, never copies); dragging out of the window becomes an OS drag that can be dropped
 * onto the desktop or a file manager. The panel uses pointer events instead of HTML5 drag-and-drop to
 * avoid clashing with native file drops onto the window.
 */
export function useFileRowDrag({ onDrop, prepareNativeDrag, onNativeDragEnd }: FileRowDragOptions) {
  const cleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanupRef.current?.(), []);

  return (event: ReactPointerEvent<HTMLElement>, items: FileDragItem[]) => {
    if (event.button !== 0 || event.isPrimary === false || items.length === 0) return;
    // The expander and the rename input never start a drag (matched with panel-agnostic markers).
    if ((event.target as HTMLElement).closest('input, [data-row-expander]')) return;

    cleanupRef.current?.();
    const source = event.currentTarget;
    const { pointerId, clientX, clientY } = event;
    let started = false;
    let canceled = false;
    let clickTimer: ReturnType<typeof setTimeout> | undefined;
    source.setPointerCapture?.(pointerId);

    const move = (next: PointerEvent) => {
      if (next.pointerId !== pointerId || canceled) return;
      if (!started && Math.hypot(next.clientX - clientX, next.clientY - clientY) < DRAG_THRESHOLD_PX) return;
      if (!started) {
        started = true;
        useFileDragStore.getState().start(items, { x: next.clientX, y: next.clientY });
      }
      next.preventDefault();
      // Left the window: switch to an OS drag (droppable on the desktop / file manager).
      if (isOutsideWindow(next.clientX, next.clientY)) {
        canceled = true;
        useFileDragStore.getState().end();
        clean();
        void (async () => {
          if (!prepareNativeDrag) {
            // Local panel: hand the paths to the OS right now, while the pointer button is still
            // down. Windows only starts a drop session inside the press, so awaiting anything
            // here would silently drop the drag.
            const payload: NativeDragPayload = { paths: items.map((item) => item.path), mode: 'move' };
            beginNativeDrag(payload, (result) => onNativeDragEnd?.(result, items, payload));
            return;
          }
          const payload = await prepareNativeDrag(items);
          if (payload) beginNativeDrag(payload, (result) => onNativeDragEnd?.(result, items, payload));
        })();
        return;
      }
      const store = useFileDragStore.getState();
      store.movePointer({ x: next.clientX, y: next.clientY });
      store.hover(locateDropTarget(next.clientX, next.clientY));
    };
    const suppressClick = (next: MouseEvent) => {
      if (started) { next.preventDefault(); next.stopImmediatePropagation(); }
    };
    const removeClick = () => window.removeEventListener('click', suppressClick, true);

    const clean = () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', cancel, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', cancel);
      if (source.hasPointerCapture?.(pointerId)) source.releasePointerCapture(pointerId);
      if (started) useFileDragStore.getState().end();
      // The browser still dispatches a click after pointerup: release the suppression one tick later
      // so the drop does not double as a selection.
      clickTimer = setTimeout(removeClick, 0);
      cleanupRef.current = () => { clearTimeout(clickTimer); removeClick(); };
    };

    const up = (next: PointerEvent) => {
      if (next.pointerId !== pointerId) return;
      if (started && !canceled) {
        const target = locateDropTarget(next.clientX, next.clientY);
        if (target) onDrop(items, target);
      }
      clean();
    };

    const cancel = () => {
      canceled = true;
      if (started) useFileDragStore.getState().end();
      clean();
    };

    const key = (next: KeyboardEvent) => {
      if (next.key !== 'Escape') return;
      next.preventDefault();
      next.stopImmediatePropagation();
      cancel();
    };

    window.addEventListener('pointermove', move, { capture: true, passive: false });
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', cancel, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('blur', cancel);
    window.addEventListener('click', suppressClick, true);
    cleanupRef.current = () => { clean(); clearTimeout(clickTimer); removeClick(); };
  };
}
