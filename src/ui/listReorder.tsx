import { create } from 'zustand';
import { createPortal } from 'react-dom';
import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { closeActiveMenu } from './hooks/useExclusiveMenu';

export interface ListReorderDrag {
  /** Container id; rows opt in with `data-reorder-list` on the list element. */
  listId: string;
  id: string;
  /** Item kind; the default matcher only accepts targets of the same kind. */
  kind: string;
  height?: number;
  width?: number;
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
 * Shared transient state for pointer-driven list reordering. The source row
 * leaves its slot, a dashed placeholder marks the expected drop position,
 * and a small preview follows the pointer.
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

/** Keep the destination stable while the pointer is over its placeholder. */
function locateTarget(
  listId: string,
  dragKind: string,
  accepts: (dragKind: string, itemKind: string) => boolean,
  x: number,
  y: number,
  axis: 'vertical' | 'horizontal',
): ListReorderTarget | null | undefined {
  const hit = document.elementFromPoint(x, y);
  if (!hit) return null;
  const list = hit.closest<HTMLElement>('[data-reorder-list]');
  if (!list || list.dataset.reorderList !== listId) return null;
  if (hit.closest('[data-reorder-placeholder]')) return undefined;
  // Resolve rows within the hovered zone, falling back to the zone itself
  // when its rows are hidden or empty.
  const zone = hit.closest<HTMLElement>('[data-reorder-zone]');
  const area = zone && list.contains(zone) && accepts(dragKind, zone.dataset.reorderKind ?? '') ? zone : null;
  const items = Array.from((area ?? list).querySelectorAll<HTMLElement>('[data-reorder-item]:not([data-reorder-dragging="true"])'))
    .filter((item) => !item.closest('[hidden]') && accepts(dragKind, item.dataset.reorderKind ?? ''));
  for (const item of items) {
    const rect = item.getBoundingClientRect();
    if (axis === 'horizontal' ? x < rect.left + rect.width / 2 : y < rect.top + rect.height / 2) return { itemId: item.dataset.reorderItem, after: false };
  }
  const last = items[items.length - 1];
  if (last) return { itemId: last.dataset.reorderItem, after: true };
  if (area) return { zoneId: area.dataset.reorderZone };
  return null;
}

/** Pointer gesture shared by horizontal and vertical lists. */
export function useListReorderDrag({ listId, accepts, onDrop, axis = 'vertical' }: {
  listId: string;
  axis?: 'vertical' | 'horizontal';
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
    const target = event.target as HTMLElement;
    if (target.closest('input, [data-no-drag]') || target.closest('button') && !target.closest('[data-reorder-handle]')) return;
    event.stopPropagation();
    cleanupRef.current?.();
    const source = target.closest<HTMLElement>('[data-reorder-handle]') ?? event.currentTarget;
    const container = event.currentTarget.dataset.reorderMeasure === 'container' ? event.currentTarget.closest<HTMLElement>('[data-reorder-container]') : null;
    const bounds = (container ?? event.currentTarget).getBoundingClientRect();
    const dimensions = bounds.height > 0 ? { height: bounds.height, ...(axis === 'horizontal' ? { width: bounds.width } : {}) } : {};
    const { pointerId, clientX, clientY } = event;
    let started = false;
    let canceled = false;
    let clickTimer: ReturnType<typeof setTimeout> | undefined;
    source.setPointerCapture?.(pointerId);

    const match = (dragKind: string, itemKind: string) =>
      (acceptsRef.current ?? ((drag: string, over: string) => drag === over))(dragKind, itemKind);
    const preview = (x: number, y: number) => {
      useListReorder.getState().movePointer(x, y);
      const list = axis === 'horizontal' ? Array.from(document.querySelectorAll<HTMLElement>('[data-reorder-list]')).find(element => element.dataset.reorderList === listId) : null;
      if (axis === 'horizontal' && list) {
        const bounds = list.getBoundingClientRect();
        if (x > bounds.right - 28) list.scrollLeft += 20;
        else if (x < bounds.left + 28) list.scrollLeft -= 20;
      }
      const target = locateTarget(listId, item.kind, match, x, y, axis);
      if (target === undefined) return;
      useListReorder.getState().hover(target);
    };
    const move = (next: PointerEvent) => {
      if (next.pointerId !== pointerId || canceled) return;
      if (!started && Math.hypot(next.clientX - clientX, next.clientY - clientY) < 6) return;
      if (!started) {
        started = true;
        closeActiveMenu();
        window.dispatchEvent(new Event('list-reorder-start'));
        useListReorder.getState().start({ listId, id: item.id, kind: item.kind, ...dimensions }, { x: next.clientX, y: next.clientY });
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
        dropRef.current({ listId, id: item.id, kind: item.kind, ...dimensions }, useListReorder.getState().target);
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

/** Dashed gap rendered before or after the hovered item. */
export function ListReorderPlaceholder({ listId, itemId, after = false }: { listId: string; itemId: string; after?: boolean }) {
  const show = useListReorder(state => !!state.drag && state.drag.listId === listId && state.target?.itemId === itemId && !!state.target.after === after);
  const height = useListReorder(state => state.drag?.height); const width = useListReorder(state => state.drag?.width);
  return show ? <div className="sidebar-reorder-placeholder" style={height ? { height, ...(width ? { width } : {}) } : undefined} data-reorder-placeholder={itemId} aria-hidden="true" /> : null;
}

/** Empty and collapsed groups remain available as append destinations. */
export function ListReorderZonePlaceholder({ listId, zoneId }: { listId: string; zoneId: string }) {
  const show = useListReorder(state => !!state.drag && state.drag.listId === listId && state.target?.zoneId === zoneId);
  const height = useListReorder(state => state.drag?.height);
  return show ? <div className="sidebar-reorder-placeholder" style={height ? { height } : undefined} data-reorder-placeholder={zoneId} aria-hidden="true" /> : null;
}

/** Small icon tile follows the pointer without intercepting drop targets. */
export function ListReorderPreview({ listId, children }: { listId: string; children: (drag: ListReorderDrag) => ReactNode }) {
  const drag = useListReorder(state => state.drag?.listId === listId ? state.drag : null);
  const position = useListReorder(state => state.position);
  if (!drag || !position) return null;
  return createPortal(<div className="sidebar-reorder-preview" aria-hidden="true" style={{ left: position.x, top: position.y }}>{children(drag)}</div>, document.body);
}
