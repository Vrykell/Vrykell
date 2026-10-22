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
  /** Group highlighted for a pending "drop into the collapsed group" dwell. */
  dwellZoneId: string | null;
  start: (drag: ListReorderDrag, position: { x: number; y: number }) => void;
  movePointer: (x: number, y: number) => void;
  hover: (target: ListReorderTarget | null) => void;
  setDwell: (zoneId: string | null) => void;
  end: () => void;
}

/** Dwell before a hovered collapsed group accepts the drop (Firefox uses ~400 ms). */
const GROUP_DWELL_MS = 400;

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
  dwellZoneId: null,
  start: (drag, position) => set({ drag, target: null, position, dwellZoneId: null }),
  movePointer: (x, y) => set({ position: { x, y } }),
  hover: (target) => set((state) => (sameTarget(state.target, target) ? state : { target })),
  setDwell: (zoneId) => set((state) => (state.dwellZoneId === zoneId ? state : { dwellZoneId: zoneId })),
  end: () => set({ drag: null, target: null, position: null, dwellZoneId: null }),
}));

/** Keep the destination stable while the pointer is over its placeholder. */
function locateTarget(
  listId: string,
  dragKind: string,
  accepts: (dragKind: string, itemKind: string) => boolean,
  x: number,
  y: number,
  axis: 'vertical' | 'horizontal',
  edgeDrop: boolean,
): ListReorderTarget | null | undefined {
  const hit = document.elementFromPoint(x, y);
  if (!hit) return null;
  const list = hit.closest<HTMLElement>('[data-reorder-list]');
  if (!list || list.dataset.reorderList !== listId) {
    // Opt-in for vertical lists that need the empty area just past their rows (the workspace
    // navigation). Other lists keep strict bounds so their zone drops stay unambiguous.
    if (!edgeDrop || axis !== 'vertical') return null;
    const root = document.querySelector<HTMLElement>(`[data-reorder-list="${listId}"]`);
    if (!root) return null;
    const bounds = root.getBoundingClientRect();
    if (x < bounds.left || x > bounds.right || y > bounds.bottom + 200) return null;
    const rows = Array.from(root.querySelectorAll<HTMLElement>('[data-reorder-item]:not([data-reorder-dragging="true"])'))
      .filter(item => !item.closest('[hidden]') && accepts(dragKind, item.dataset.reorderKind ?? ''));
    if (!rows.length) return null;
    if (y < bounds.top) return { itemId: rows[0]!.dataset.reorderItem, after: false };
    return { itemId: rows[rows.length - 1]!.dataset.reorderItem, after: true };
  }
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
export function useListReorderDrag({ listId, accepts, onDrop, axis = 'vertical', grouped = false, endZoneId, edgeDrop = false }: {
  listId: string;
  axis?: 'vertical' | 'horizontal';
  /** Resolve horizontal destinations within their group or empty drop zone. */
  grouped?: boolean;
  /** Zone that receives an item dropped past the last unit of a grouped horizontal list. */
  endZoneId?: string;
  /** Accept drops past a vertical list's first/last row in the surrounding empty area. */
  edgeDrop?: boolean;
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
    // Captured now: React clears `currentTarget` once the pointerdown handler returns.
    const sourceZone = container ? undefined : event.currentTarget.closest<HTMLElement>('[data-reorder-zone]')?.dataset.reorderZone;
    const dimensions: Pick<ListReorderDrag, 'height' | 'width' | 'origin'> = bounds.height > 0 ? { height: bounds.height, ...(axis === 'horizontal' ? {
      width: bounds.width,
      origin: { top: bounds.top, offsetX: event.clientX - bounds.left, minLeft: listBounds.left, maxLeft: Math.max(listBounds.left, listBounds.right - bounds.width) },
    } : {}) } : {};
    const { pointerId, clientX, clientY } = event;
    const match = (dragKind: string, itemKind: string) =>
      (acceptsRef.current ?? ((drag: string, over: string) => drag === over))(dragKind, itemKind);
    // Grouped horizontal lists (terminal tabs) follow the browser tab-strip model: one
    // flat sequence of visible units — a group label, then its visible members, then loose
    // tabs — captured once with the dragged unit removed and every later unit shifted by
    // the space it left behind. Insertion is a single midpoint scan of the dragged leading
    // edge, so a group can never overlap its own members in the ordering (Firefox's element
    // index, Chromium's leading-edge comparison).
    interface HorizontalUnit { id: string; kind: string; zoneId?: string; mid: number; right: number; }
    const units: HorizontalUnit[] = [];
    let endTarget: ListReorderTarget | null = null;
    if (axis === 'horizontal' && grouped && sourceList) {
      const anchor = container ?? event.currentTarget;
      const anchorStyle = getComputedStyle(anchor);
      const gap = parseFloat(getComputedStyle(sourceList).columnGap) || 0;
      const sourceOuter = bounds.width + (parseFloat(anchorStyle.marginLeft) || 0) + (parseFloat(anchorStyle.marginRight) || 0) + gap;
      for (const element of Array.from(sourceList.querySelectorAll<HTMLElement>('[data-reorder-item]'))) {
        if (container ? container.contains(element) : element === event.currentTarget) continue;
        const kind = element.dataset.reorderKind ?? '';
        if (!match(item.kind, kind)) continue;
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0) continue;
        const after = !!(anchor.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING);
        const left = rect.left - listBounds.left + scrollLeft - (after ? sourceOuter : 0);
        units.push({
          id: element.dataset.reorderItem!, kind,
          zoneId: element.closest<HTMLElement>('[data-reorder-zone]')?.dataset.reorderZone,
          mid: left + rect.width / 2, right: left + rect.width,
        });
      }
      endTarget = endZoneId ? { zoneId: endZoneId }
        : units.length ? { itemId: units[units.length - 1]!.id, after: true } : null;
    }
    const horizontalRows = axis === 'horizontal' && !grouped && sourceList ? Array.from(sourceList.querySelectorAll<HTMLElement>('[data-reorder-item]'))
      .filter(row => !row.closest('[hidden]') && match(item.kind, row.dataset.reorderKind ?? ''))
      .map(row => ({ id: row.dataset.reorderItem!, zoneId: row.closest<HTMLElement>('[data-reorder-zone]')?.dataset.reorderZone,
        bounds: (row.dataset.reorderMeasure === 'container' ? row.closest<HTMLElement>('[data-reorder-container]') ?? row : row).getBoundingClientRect() })) : [];
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
    let dwellZone: string | null = null;
    let dwellTimer: ReturnType<typeof setTimeout> | undefined;
    let dwellFired = false;
    const clearDwell = () => {
      if (dwellTimer !== undefined) clearTimeout(dwellTimer);
      dwellTimer = undefined;
      dwellZone = null;
      dwellFired = false;
      useListReorder.getState().setDwell(null);
    };
    source.setPointerCapture?.(pointerId);

    const findHorizontalList = () => axis === 'horizontal' ? Array.from(document.querySelectorAll<HTMLElement>('[data-reorder-list]')).find(element => element.dataset.reorderList === listId) : null;
    const updateTarget = (x: number, y: number) => {
      const list = findHorizontalList();
      if (axis === 'horizontal' && grouped && list && dimensions.origin && listBounds.width > 0) {
        const previewLeft = horizontalPreviewLeft(x, dimensions.origin);
        const leading = previewLeft - listBounds.left + list.scrollLeft;
        const centerX = previewLeft + (dimensions.width ?? 0) / 2;
        // The empty tail of a grouped list keeps its own zone: dropping there leaves the group.
        const centerZone = document.elementFromPoint(centerX, y)?.closest<HTMLElement>('[data-reorder-zone]');
        const emptyZone = centerZone && list.contains(centerZone) && match(item.kind, centerZone.dataset.reorderKind ?? '')
          ? centerZone.dataset.reorderZone : undefined;
        // A collapsed group accepts the drop only after the pointer dwells on its label.
        const pointerZone = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-reorder-zone]');
        const pointerZoneId = pointerZone && list.contains(pointerZone) ? pointerZone.dataset.reorderZone : undefined;
        let dwell: string | undefined;
        if (pointerZoneId && match(item.kind, 'group')) {
          const label = units.find(candidate => candidate.id === pointerZoneId && candidate.kind === 'group');
          const hasMembers = units.some(candidate => candidate.zoneId === pointerZoneId && candidate.kind !== 'group');
          if (label && !hasMembers) dwell = pointerZoneId;
        }
        let index = units.length;
        for (let i = 0; i < units.length; i++) if (leading < units[i]!.mid) { index = i; break; }
        const unit = units[index];
        // A member tab dragged out of its group can leave through the empty tail even while
        // its leading edge still overlaps the group; a loose tab follows the midpoint scan.
        let resolved: ListReorderTarget | null;
        if (!unit) {
          const last = units[units.length - 1];
          if (emptyZone && !units.some(candidate => candidate.zoneId === emptyZone)) resolved = { zoneId: emptyZone };
          // Past the last member's midpoint but still inside the group: append to the group.
          else if (last && last.kind === 'tab' && last.zoneId && leading < last.right) resolved = { itemId: last.id, after: true };
          // A trailing collapsed group keeps the tab beside it, never inside it.
          else if (last && last.kind === 'group') resolved = { itemId: last.id, after: true };
          else resolved = endTarget;
        } else if (emptyZone && sourceZone && !units.some(candidate => candidate.zoneId === emptyZone)) {
          resolved = { zoneId: emptyZone };
        } else if (item.kind === 'group') {
          // A dragged group never nests: over a member it lands after that whole group.
          if (unit.kind === 'group') resolved = { itemId: unit.id, after: leading >= unit.mid };
          else if (unit.zoneId) resolved = { itemId: unit.zoneId, after: true };
          else resolved = { itemId: unit.id, after: false };
        } else if (unit.kind === 'group') {
          if (leading < unit.mid) resolved = { itemId: unit.id, after: false };
          else {
            const member = units[index + 1];
            if (member && member.zoneId === unit.id) resolved = { itemId: member.id, after: false };
            // A collapsed or empty group drops after it unless the pointer dwells on it.
            else resolved = { itemId: unit.id, after: true };
          }
        } else {
          resolved = { itemId: unit.id, after: false };
        }
        if (dwell) {
          if (dwellFired && dwellZone === dwell) { useListReorder.getState().hover({ zoneId: dwell }); return; }
          if (dwellZone !== dwell) {
            if (dwellTimer !== undefined) clearTimeout(dwellTimer);
            dwellZone = dwell;
            dwellFired = false;
            dwellTimer = setTimeout(() => {
              dwellFired = true;
              useListReorder.getState().setDwell(dwell);
              useListReorder.getState().hover({ zoneId: dwell });
            }, GROUP_DWELL_MS);
          }
          useListReorder.getState().hover(resolved);
          return;
        }
        clearDwell();
        useListReorder.getState().hover(resolved);
        return;
      }
      if (axis === 'horizontal' && list) {
        if (list !== currentList) { list.scrollLeft = scrollLeft; currentList = list; }
        const bounds = list.getBoundingClientRect();
        if (dimensions.origin && sourceIndex >= 0 && listBounds.width > 0) {
          // Compare the moving edges against stable slots, independent of the pointer's grab offset and the rendered gap.
          const previewLeft = horizontalPreviewLeft(x, dimensions.origin);
          const left = previewLeft - bounds.left + list.scrollLeft;
          const right = left + slotWidth;
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
          const next = horizontalSlots[insertionIndex]; const last = horizontalSlots[horizontalSlots.length - 1];
          useListReorder.getState().hover(next ? { itemId: next.id, after: false } : last ? { itemId: last.id, after: true } : null);
          return;
        }
      }
      const target = locateTarget(listId, item.kind, match, x, y, axis, edgeDrop);
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
      clearDwell();
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
export function ListReorderPreview({ listId, variant = 'icon', className = '', children }: {
  listId: string; variant?: 'icon' | 'item'; className?: string; children: (drag: ListReorderDrag) => ReactNode;
}) {
  const drag = useListReorder(state => state.drag?.listId === listId ? state.drag : null);
  const position = useListReorder(state => state.position);
  if (!drag || !position) return null;
  const style = variant === 'item' && drag.origin ? {
    left: horizontalPreviewLeft(position.x, drag.origin),
    top: drag.origin.top, width: drag.width, height: drag.height,
  } : { left: position.x, top: position.y };
  return createPortal(<div className={`${variant === 'item' ? 'list-reorder-item-preview' : 'sidebar-reorder-preview'}${className ? ` ${className}` : ''}`}
    data-reorder-preview={variant} aria-hidden="true" inert style={style}>{children(drag)}</div>, document.body);
}
