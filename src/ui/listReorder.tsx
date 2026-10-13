import { create } from 'zustand';
import { createPortal } from 'react-dom';
import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';

export interface ListReorderDrag {
  /** Container id; rows opt in with `data-reorder-list` on the list element. */
  listId: string;
  id: string;
  /** Item kind; the default matcher only accepts targets of the same kind. */
  kind: string;
}

export interface ListReorderTarget {
  /** Hovered item id (with `after` telling which side of it). */
  itemId?: string;
  after?: boolean;
  /** Hovered drop zone (group container / ungrouped area) resolved to its id. */
  zoneId?: string;
}

interface ListReorderState {
  drag: ListReorderDrag | null;
  target: ListReorderTarget | null;
  position: { x: number; y: number } | null;
  start: (drag: ListReorderDrag, position: { x: number; y: number }) => void;
  movePointer: (x: number, y: number) => void;
  hover: (target: ListReorderTarget | null) => void;
  end: () => void;
}

function sameTarget(a: ListReorderTarget | null, b: ListReorderTarget | null): boolean {
  return a === b || (!!a && !!b && a.itemId === b.itemId && a.after === b.after && a.zoneId === b.zoneId);
}

/**
 * Shared transient state for pointer-driven list reordering. Mirrors the
 * titlebar navigation drag: the source row is hidden, a dashed placeholder
 * reserves the expected drop slot, and a small preview follows the pointer.
 */
export const useListReorder = create<ListReorderState>((set) => ({
  drag: null,
  target: null,
  position: null,
  start: (drag, position) => set({ drag, target: null, position }),
  movePointer: (x, y) => set({ position: { x, y } }),
  hover: (target) => set((state) => (sameTarget(state.target, target) ? state : { target })),
  end: () => set({ drag: null, target: null, position: null }),
}));

/**
 * Resolve the drop target under the pointer.
 *
 * Returns `undefined` when the pointer is over the placeholder itself — the
 * gap must stay stable while hovering it, otherwise the slot flickers.
 */
function locateTarget(
  listId: string,
  dragKind: string,
  accepts: (dragKind: string, itemKind: string) => boolean,
  x: number,
  y: number,
): ListReorderTarget | null | undefined {
  const hit = document.elementFromPoint(x, y);
  if (!hit) return null;
  const list = hit.closest<HTMLElement>(`[data-reorder-list="${listId}"]`);
  if (!list) return null;
  if (hit.closest('[data-reorder-placeholder]')) return undefined;
  // 指针所在的分区（分组容器 / 未分组区）：行与分区都接受这次拖动时，
  // 只在该分区内找最近的行，空位才会落在指针所在的分组里（拖动本身仍按几何位置
  // 判定，行与行之间的间隙也算在相邻行上）；分区里一行都没有（收起或空分区）时
  // 才退回「追加到该分区」。
  const zone = hit.closest<HTMLElement>('[data-reorder-zone]');
  const area = zone && list.contains(zone) && accepts(dragKind, zone.dataset.reorderKind ?? '') ? zone : null;
  const items = Array.from((area ?? list).querySelectorAll<HTMLElement>('[data-reorder-item]:not([data-reorder-dragging="true"])'))
    .filter((item) => accepts(dragKind, item.dataset.reorderKind ?? ''));
  for (const item of items) {
    const rect = item.getBoundingClientRect();
    if (y < rect.top + rect.height / 2) return { itemId: item.dataset.reorderItem, after: false };
  }
  const last = items[items.length - 1];
  if (last) return { itemId: last.dataset.reorderItem, after: true };
  if (area) return { zoneId: area.dataset.reorderZone };
  return null;
}

/** Pointer gesture for reordering one list. Same behaviour as the titlebar buttons. */
export function useListReorderDrag({ listId, accepts, onDrop }: {
  listId: string;
  /** Item-kind matcher; defaults to "same kind only". */
  accepts?: (dragKind: string, itemKind: string) => boolean;
  onDrop: (drag: ListReorderDrag, target: ListReorderTarget | null) => void;
}) {
  const cleanupRef = useRef<(() => void) | null>(null);
  const dropRef = useRef(onDrop);
  dropRef.current = onDrop;
  const acceptsRef = useRef(accepts);
  acceptsRef.current = accepts;
  useEffect(() => () => cleanupRef.current?.(), []);

  return (event: ReactPointerEvent<HTMLElement>, item: { id: string; kind: string }) => {
    if (event.button !== 0 || event.isPrimary === false) return;
    // Rows stay clickable: inputs, action buttons and opt-out nodes never start a drag.
    if ((event.target as HTMLElement).closest('input, button, [data-no-drag]')) return;
    event.stopPropagation();
    cleanupRef.current?.();
    const source = event.currentTarget;
    const { pointerId, clientX, clientY } = event;
    let started = false;
    let canceled = false;
    let clickTimer: ReturnType<typeof setTimeout> | undefined;
    source.setPointerCapture?.(pointerId);

    const match = (dragKind: string, itemKind: string) =>
      (acceptsRef.current ?? ((drag: string, over: string) => drag === over))(dragKind, itemKind);
    const preview = (x: number, y: number) => {
      useListReorder.getState().movePointer(x, y);
      const target = locateTarget(listId, item.kind, match, x, y);
      if (target === undefined) return;
      useListReorder.getState().hover(target);
    };
    const move = (next: PointerEvent) => {
      if (next.pointerId !== pointerId || canceled) return;
      if (!started && Math.hypot(next.clientX - clientX, next.clientY - clientY) < 6) return;
      if (!started) {
        started = true;
        useListReorder.getState().start({ listId, id: item.id, kind: item.kind }, { x: next.clientX, y: next.clientY });
      }
      next.preventDefault();
      preview(next.clientX, next.clientY);
    };
    const suppressClick = (next: MouseEvent) => {
      if (started) {
        next.preventDefault();
        next.stopImmediatePropagation();
      }
    };
    const removeClick = () => window.removeEventListener('click', suppressClick, true);
    const clean = () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', cancel, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', cancel);
      if (source.hasPointerCapture?.(pointerId)) source.releasePointerCapture(pointerId);
      if (started) useListReorder.getState().end();
      // Pointerup produces a click synchronously; keep that click from activating the row.
      clickTimer = setTimeout(removeClick, 0);
      cleanupRef.current = () => {
        clearTimeout(clickTimer);
        removeClick();
      };
    };
    const up = (next: PointerEvent) => {
      if (next.pointerId !== pointerId) return;
      if (started && !canceled) {
        preview(next.clientX, next.clientY);
        dropRef.current({ listId, id: item.id, kind: item.kind }, useListReorder.getState().target);
      }
      clean();
    };
    const cancel = () => clean();
    const key = (next: KeyboardEvent) => {
      if (next.key === 'Escape') {
        next.preventDefault();
        next.stopImmediatePropagation();
        canceled = true;
        useListReorder.getState().end();
        // Keep capture until release so cancellation cannot turn into a row click.
      }
    };
    window.addEventListener('pointermove', move, { capture: true, passive: false });
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', cancel, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('blur', cancel);
    window.addEventListener('click', suppressClick, true);
    cleanupRef.current = () => {
      clean();
      clearTimeout(clickTimer);
      removeClick();
    };
  };
}

/** Dashed gap rendered before/after the hovered item. */
export function ListReorderPlaceholder({ listId, itemId, after = false }: {
  listId: string;
  itemId: string;
  after?: boolean;
}) {
  const show = useListReorder((state) =>
    !!state.drag && state.drag.listId === listId && state.target?.itemId === itemId && !!state.target.after === after);
  return show ? <div className="sidebar-reorder-placeholder" data-reorder-placeholder={itemId} aria-hidden="true" /> : null;
}

/** Dashed gap for container drops (append into a group or the ungrouped area). */
export function ListReorderZonePlaceholder({ listId, zoneId }: { listId: string; zoneId: string }) {
  const show = useListReorder((state) =>
    !!state.drag && state.drag.listId === listId && state.target?.zoneId === zoneId);
  return show ? <div className="sidebar-reorder-placeholder" data-reorder-placeholder={zoneId} aria-hidden="true" /> : null;
}

/** Floating tile that follows the pointer while a list row is being dragged. */
export function ListReorderPreview({ listId, children }: { listId: string; children: (drag: ListReorderDrag) => ReactNode }) {
  const drag = useListReorder((state) => (state.drag && state.drag.listId === listId ? state.drag : null));
  const position = useListReorder((state) => state.position);
  if (!drag || !position) return null;
  return createPortal(
    <div className="sidebar-reorder-preview" aria-hidden="true" style={{ left: position.x, top: position.y }}>
      {children(drag)}
    </div>,
    document.body,
  );
}
