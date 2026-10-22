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
  origin?: { top: number; offsetX: number; minLeft: number; maxLeft: number };
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

function horizontalPreviewLeft(x: number, origin: NonNullable<ListReorderDrag['origin']>): number {
  return Math.max(origin.minLeft, Math.min(origin.maxLeft, x - origin.offsetX));
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
export function useListReorderDrag({ listId, accepts, onDrop, axis = 'vertical', grouped = false }: {
  listId: string;
  axis?: 'vertical' | 'horizontal';
  /** Resolve horizontal destinations within their group or empty drop zone. */
  grouped?: boolean;
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
    const sourceList = event.currentTarget.closest<HTMLElement>('[data-reorder-list]');
    const listBounds = sourceList?.getBoundingClientRect() ?? bounds;
    const scrollLeft = sourceList?.scrollLeft ?? 0;
    const dimensions: Pick<ListReorderDrag, 'height' | 'width' | 'origin'> = bounds.height > 0 ? { height: bounds.height, ...(axis === 'horizontal' ? {
      width: bounds.width,
      origin: { top: bounds.top, offsetX: event.clientX - bounds.left, minLeft: listBounds.left, maxLeft: Math.max(listBounds.left, listBounds.right - bounds.width) },
    } : {}) } : {};
    const { pointerId, clientX, clientY } = event;
    const match = (dragKind: string, itemKind: string) =>
      (acceptsRef.current ?? ((drag: string, over: string) => drag === over))(dragKind, itemKind);
    const horizontalRows = axis === 'horizontal' && sourceList ? Array.from(sourceList.querySelectorAll<HTMLElement>('[data-reorder-item]'))
      .filter(row => !row.closest('[hidden]') && match(item.kind, row.dataset.reorderKind ?? ''))
      .map(row => ({ id: row.dataset.reorderItem!, zoneId: row.closest<HTMLElement>('[data-reorder-zone]')?.dataset.reorderZone,
        bounds: (row.dataset.reorderMeasure === 'container' ? row.closest<HTMLElement>('[data-reorder-container]') ?? row : row).getBoundingClientRect() })) : [];
    const sourceZone = grouped && !container ? event.currentTarget.closest<HTMLElement>('[data-reorder-zone]')?.dataset.reorderZone : undefined;
    const sourceIndex = horizontalRows.findIndex(row => row.id === item.id);
    const slotWidth = bounds.width + (sourceList ? parseFloat(getComputedStyle(sourceList).columnGap) || 0 : 0);
    const horizontalSlots = horizontalRows.flatMap((row, index) => row.id === item.id ? [] : [{
      id: row.id, zoneId: row.zoneId, width: row.bounds.width,
      left: row.bounds.left - listBounds.left + scrollLeft - (index > sourceIndex ? slotWidth : 0),
    }]);
    let insertionIndex = sourceIndex;
    let currentList = sourceList;
    let started = false;
    let canceled = false;
    let pointer = { x: clientX, y: clientY };
    let direction = 0;
    let scrollFrame: number | undefined;
    let scrollTime: number | undefined;
    let clickTimer: ReturnType<typeof setTimeout> | undefined;
    source.setPointerCapture?.(pointerId);

    const findHorizontalList = () => axis === 'horizontal' ? Array.from(document.querySelectorAll<HTMLElement>('[data-reorder-list]')).find(element => element.dataset.reorderList === listId) : null;
    const updateTarget = (x: number, y: number) => {
      const list = findHorizontalList();
      if (axis === 'horizontal' && list) {
        if (list !== currentList) { list.scrollLeft = scrollLeft; currentList = list; }
        const bounds = list.getBoundingClientRect();
        if (dimensions.origin && sourceIndex >= 0 && listBounds.width > 0) {
          // Compare the moving edges against stable slots, independent of the pointer's grab offset and the rendered gap.
          const previewLeft = horizontalPreviewLeft(x, dimensions.origin);
          const left = previewLeft - bounds.left + list.scrollLeft;
          const right = left + slotWidth;
          if (sourceZone) {
            // Empty and folded zones use the dragged component's center, never the pointer's grab position.
            const hit = document.elementFromPoint(previewLeft + (dimensions.width ?? 0) / 2, bounds.top + bounds.height / 2);
            const zone = hit?.closest<HTMLElement>('[data-reorder-zone]');
            if (zone && list.contains(zone) && match(item.kind, zone.dataset.reorderKind ?? '')
              && !horizontalSlots.some(row => row.zoneId === zone.dataset.reorderZone)) {
              useListReorder.getState().hover({ zoneId: zone.dataset.reorderZone }); return;
            }
          }
          while (insertionIndex > 0) {
            const previous = horizontalSlots[insertionIndex - 1]!;
            if (left >= previous.left + previous.width / 2 - 2) break;
            insertionIndex -= 1;
          }
          while (insertionIndex < horizontalSlots.length) {
            const next = horizontalSlots[insertionIndex]!;
            if (right <= next.left + slotWidth + next.width / 2 + 2) break;
            insertionIndex += 1;
          }
          if (sourceZone) {
            const previous = horizontalSlots[insertionIndex - 1]; const next = horizontalSlots[insertionIndex];
            const following = horizontalSlots.slice(sourceIndex).find(row => row.zoneId === sourceZone);
            const preceding = horizontalSlots.slice(0, sourceIndex).filter(row => row.zoneId === sourceZone);
            const last = preceding[preceding.length - 1];
            const target = insertionIndex > sourceIndex && previous ? { itemId: previous.id, after: true }
              : insertionIndex < sourceIndex && next ? { itemId: next.id, after: false }
              : following ? { itemId: following.id, after: false } : last ? { itemId: last.id, after: true } : { zoneId: sourceZone };
            useListReorder.getState().hover(target); return;
          }
          const next = horizontalSlots[insertionIndex]; const last = horizontalSlots[horizontalSlots.length - 1];
          useListReorder.getState().hover(next ? { itemId: next.id, after: false } : last ? { itemId: last.id, after: true } : null);
          return;
        }
      }
      const target = locateTarget(listId, item.kind, match, x, y, axis);
      if (target === undefined) return;
      useListReorder.getState().hover(target);
    };
    const stopScrolling = () => {
      if (scrollFrame !== undefined) cancelAnimationFrame(scrollFrame);
      scrollFrame = undefined;
      scrollTime = undefined;
    };
    const scrollVelocity = (list: HTMLElement) => {
      if (!dimensions.origin || !direction) return 0;
      const bounds = list.getBoundingClientRect();
      const left = pointer.x - dimensions.origin.offsetX;
      const distance = direction > 0 ? bounds.right - left - (dimensions.width ?? 0) : left - bounds.left;
      return direction * 720 * Math.max(0, Math.min(1, (28 - distance) / 28));
    };
    const scheduleScrolling = () => {
      const list = findHorizontalList();
      const velocity = list ? scrollVelocity(list) : 0;
      const limit = list ? Math.max(0, list.scrollWidth - list.clientWidth) : 0;
      if (!list || !velocity || (velocity < 0 ? list.scrollLeft <= 0 : list.scrollLeft >= limit)) {
        stopScrolling();
        return;
      }
      if (scrollFrame === undefined) scrollFrame = requestAnimationFrame(scroll);
    };
    const scroll = (time: number) => {
      scrollFrame = undefined;
      const list = findHorizontalList();
      if (!list || !started || canceled) { stopScrolling(); return; }
      const elapsed = scrollTime === undefined ? 16 : Math.min(32, time - scrollTime);
      scrollTime = time;
      list.scrollLeft = Math.max(0, Math.min(list.scrollWidth - list.clientWidth, list.scrollLeft + scrollVelocity(list) * elapsed / 1000));
      // Scrolling changes the drop slot even while the pointer remains stationary.
      updateTarget(pointer.x, pointer.y);
      scheduleScrolling();
    };
    const preview = (x: number, y: number) => {
      if (x !== pointer.x) direction = Math.sign(x - pointer.x);
      pointer = { x, y };
      useListReorder.getState().movePointer(x, y);
      updateTarget(x, y);
      scheduleScrolling();
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
      stopScrolling();
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
        stopScrolling();
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
  const height = useListReorder(state => state.drag?.height); const width = useListReorder(state => state.drag?.width);
  return show ? <div className="sidebar-reorder-placeholder" style={height ? { height, ...(width ? { width } : {}) } : undefined} data-reorder-placeholder={zoneId} aria-hidden="true" /> : null;
}

/** A preview follows the pointer without intercepting drop targets. */
export function ListReorderPreview({ listId, variant = 'icon', children }: { listId: string; variant?: 'icon' | 'item'; children: (drag: ListReorderDrag) => ReactNode }) {
  const drag = useListReorder(state => state.drag?.listId === listId ? state.drag : null);
  const position = useListReorder(state => state.position);
  if (!drag || !position) return null;
  const style = variant === 'item' && drag.origin ? {
    left: horizontalPreviewLeft(position.x, drag.origin),
    top: drag.origin.top, width: drag.width, height: drag.height,
  } : { left: position.x, top: position.y };
  return createPortal(<div className={variant === 'item' ? 'list-reorder-item-preview' : 'sidebar-reorder-preview'} data-reorder-preview={variant} aria-hidden="true" inert style={style}>{children(drag)}</div>, document.body);
}
