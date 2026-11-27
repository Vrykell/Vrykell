import { create } from 'zustand';
import { createPortal } from 'react-dom';
import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { closeActiveMenu } from '../hooks/useExclusiveMenu';

export interface ListReorderDrag {
  /** Container id; rows opt in with `data-reorder-list` on the list element. */
  listId: string;
  id: string;
  /** Item kind; the default matcher only accepts targets of the same kind. */
  kind: string;
  height?: number;
  width?: number;
  listWidth?: number;
  previewBackground?: string;
  origin?: { top: number; offsetX: number; offsetY: number; minLeft: number; maxLeft: number };
}

export interface ListReorderTarget {
  /** Hovered item id (with `after` telling which side of it). */
  itemId?: string;
  after?: boolean;
  /** Hovered drop zone (group container / ungrouped area) resolved to its id. */
  zoneId?: string;
}

interface ListReorderState {
  pending: boolean;
  pendingScroll: { listId: string; scrollLeft: number } | null;
  prepare: (scroll?: { listId: string; scrollLeft: number }) => void;
  drag: ListReorderDrag | null;
  /** The item remains held externally when the renderer loses pointer capture. */
  externalDragSourceId: string | null;
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

/** Holding over a collapsed group distinguishes joining it from passing over it. */
const GROUP_DWELL_MS = 400;

function sameTarget(a: ListReorderTarget | null, b: ListReorderTarget | null): boolean {
  return a === b || (!!a && !!b && a.itemId === b.itemId && a.after === b.after && a.zoneId === b.zoneId);
}

function horizontalPreviewLeft(x: number, origin: NonNullable<ListReorderDrag['origin']>): number {
  return Math.max(origin.minLeft, Math.min(origin.maxLeft, x - origin.offsetX));
}

/**
 * Shared transient state for pointer-driven list reordering. The source row
 * leaves its slot, a borderless placeholder marks the expected drop position,
 * and a small preview follows the pointer.
 */
export const useListReorder = create<ListReorderState>((set) => ({
  pending: false,
  pendingScroll: null,
  prepare: (scroll) => set({ pending: true, pendingScroll: scroll ?? null }),
  drag: null,
  externalDragSourceId: null,
  target: null,
  position: null,
  dwellZoneId: null,
  start: (drag, position) => set({ drag, target: null, position, dwellZoneId: null }),
  movePointer: (x, y) => set({ position: { x, y } }),
  hover: (target) => set((state) => (sameTarget(state.target, target) ? state : { target })),
  setDwell: (zoneId) => set((state) => (state.dwellZoneId === zoneId ? state : { dwellZoneId: zoneId })),
  end: () => set({ pending: false, pendingScroll: null, drag: null, target: null, position: null, dwellZoneId: null }),
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
    // Opt-in for vertical lists that need the surrounding area of their rows (the workspace
    // navigation). The list's container is the whole reachable region, so a docked panel below
    // the rows never cuts the end slot off. Other lists keep strict bounds so their zone drops
    // stay unambiguous.
    if (!edgeDrop || axis !== 'vertical') return null;
    const root = document.querySelector<HTMLElement>(`[data-reorder-list="${listId}"]`);
    if (!root) return null;
    const listBounds = root.getBoundingClientRect();
    const bounds = (root.parentElement ?? root).getBoundingClientRect();
    if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) return null;
    const rows = Array.from(root.querySelectorAll<HTMLElement>('[data-reorder-item]:not([data-reorder-dragging="true"])')).filter(
      (item) => !item.closest('[hidden]') && accepts(dragKind, item.dataset.reorderKind ?? ''),
    );
    if (!rows.length) return null;
    if (y < listBounds.top) return { itemId: rows[0]!.dataset.reorderItem, after: false };
    return { itemId: rows[rows.length - 1]!.dataset.reorderItem, after: true };
  }
  if (hit.closest('[data-reorder-placeholder]')) return undefined;
  // Resolve rows within the hovered zone, falling back to the zone itself
  // when its rows are hidden or empty.
  const zone = hit.closest<HTMLElement>('[data-reorder-zone]');
  const area = zone && list.contains(zone) && accepts(dragKind, zone.dataset.reorderKind ?? '') ? zone : null;
  const items = Array.from((area ?? list).querySelectorAll<HTMLElement>('[data-reorder-item]:not([data-reorder-dragging="true"])')).filter(
    (item) => !item.closest('[hidden]') && accepts(dragKind, item.dataset.reorderKind ?? ''),
  );
  for (const item of items) {
    const rect = item.getBoundingClientRect();
    if (axis === 'horizontal' ? x < rect.left + rect.width / 2 : y < rect.top + rect.height / 2)
      return { itemId: item.dataset.reorderItem, after: false };
  }
  const last = items[items.length - 1];
  if (last) return { itemId: last.dataset.reorderItem, after: true };
  if (area) return { zoneId: area.dataset.reorderZone };
  return null;
}

interface ListReorderMotionOptions {
  listId: string;
  axis: 'vertical' | 'horizontal';
  grouped: boolean;
  endZoneId?: string;
  edgeDrop: boolean;
  match: (dragKind: string, itemKind: string) => boolean;
}

type ReorderPoint = { x: number; y: number };

function createListReorderMotion(
  row: HTMLElement,
  item: { id: string; kind: string },
  point: ReorderPoint,
  { listId, axis, grouped, endZoneId, edgeDrop, match }: ListReorderMotionOptions,
  grabRatio?: number,
) {
  const container = row.dataset.reorderMeasure === 'container' ? row.closest<HTMLElement>('[data-reorder-container]') : null;
  const bounds = (container ?? row).getBoundingClientRect();
  const sourceList = row.closest<HTMLElement>('[data-reorder-list]');
  const listBounds = sourceList?.getBoundingClientRect() ?? bounds;
  const scrollLeft = sourceList?.scrollLeft ?? 0;
  const sourceZone = container ? undefined : row.closest<HTMLElement>('[data-reorder-zone]')?.dataset.reorderZone;
  const frame = sourceList?.closest('[data-reorder-frame]');
  const clearance = frame?.querySelector<HTMLElement>('[data-reorder-clearance]');
  const trailingRoom = clearance ? Math.max(0, clearance.clientWidth - (parseFloat(getComputedStyle(clearance).minWidth) || 0)) : 0;
  const paintedTab = row.matches('[data-active="true"], [data-tab-surface="true"]');
  const dimensions: Pick<ListReorderDrag, 'height' | 'width' | 'listWidth' | 'previewBackground' | 'origin'> =
    bounds.height > 0
      ? {
          height: bounds.height,
          ...(axis === 'horizontal'
            ? {
                width: bounds.width,
                listWidth: listBounds.width,
                previewBackground: paintedTab
                  ? getComputedStyle(row).backgroundColor
                  : frame
                    ? getComputedStyle(frame).backgroundColor
                    : undefined,
                origin: {
                  top: bounds.top,
                  offsetX: (grabRatio === undefined ? point.x : bounds.left + bounds.width * grabRatio) - bounds.left,
                  offsetY: point.y - bounds.top,
                  minLeft: listBounds.left,
                  maxLeft: Math.max(listBounds.left, listBounds.right + trailingRoom - bounds.width),
                },
              }
            : {}),
        }
      : {};
  const drag = { listId, id: item.id, kind: item.kind, ...dimensions };
  // Grouped horizontal lists (terminal tabs) follow the browser tab-strip model: one
  // flat sequence of visible units — a group label, then its visible members, then loose
  // tabs — captured once with the dragged unit removed and every later unit shifted by
  // the space it left behind. Insertion is a single midpoint scan of the dragged leading
  // edge, so a group can never overlap its own members in the ordering.
  interface HorizontalUnit {
    id: string;
    kind: string;
    zoneId?: string;
    mid: number;
    right: number;
  }
  const units: HorizontalUnit[] = [];
  let endTarget: ListReorderTarget | null = null;
  if (axis === 'horizontal' && grouped && sourceList) {
    const anchor = container ?? row;
    const anchorStyle = getComputedStyle(anchor);
    const gap = parseFloat(getComputedStyle(sourceList).columnGap) || 0;
    const sourceOuter = bounds.width + (parseFloat(anchorStyle.marginLeft) || 0) + (parseFloat(anchorStyle.marginRight) || 0) + gap;
    for (const element of Array.from(sourceList.querySelectorAll<HTMLElement>('[data-reorder-item]'))) {
      if (container ? container.contains(element) : element === row) continue;
      const kind = element.dataset.reorderKind ?? '';
      if (!match(item.kind, kind)) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0) continue;
      const after = !!(anchor.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING);
      const left = rect.left - listBounds.left + scrollLeft - (after ? sourceOuter : 0);
      units.push({
        id: element.dataset.reorderItem!,
        kind,
        zoneId: element.closest<HTMLElement>('[data-reorder-zone]')?.dataset.reorderZone,
        mid: left + rect.width / 2,
        right: left + rect.width,
      });
    }
    endTarget = endZoneId ? { zoneId: endZoneId } : units.length ? { itemId: units[units.length - 1]!.id, after: true } : null;
  }
  const horizontalRows =
    axis === 'horizontal' && !grouped && sourceList
      ? Array.from(sourceList.querySelectorAll<HTMLElement>('[data-reorder-item]'))
          .filter((row) => !row.closest('[hidden]') && match(item.kind, row.dataset.reorderKind ?? ''))
          .map((row) => ({
            id: row.dataset.reorderItem!,
            zoneId: row.closest<HTMLElement>('[data-reorder-zone]')?.dataset.reorderZone,
            bounds: (row.dataset.reorderMeasure === 'container'
              ? (row.closest<HTMLElement>('[data-reorder-container]') ?? row)
              : row
            ).getBoundingClientRect(),
          }))
      : [];
  const sourceIndex = horizontalRows.findIndex((row) => row.id === item.id);
  const slotWidth = bounds.width + (sourceList ? parseFloat(getComputedStyle(sourceList).columnGap) || 0 : 0);
  const horizontalSlots = horizontalRows.flatMap((row, index) =>
    row.id === item.id
      ? []
      : [
          {
            id: row.id,
            zoneId: row.zoneId,
            width: row.bounds.width,
            left: row.bounds.left - listBounds.left + scrollLeft - (index > sourceIndex ? slotWidth : 0),
          },
        ],
  );
  let insertionIndex = sourceIndex;
  let currentList = sourceList;
  let active = false;
  let pointer = point;
  let direction = 0;
  let scrollFrame: number | undefined;
  let scrollTime: number | undefined;
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
  const findHorizontalList = () =>
    axis === 'horizontal'
      ? Array.from(document.querySelectorAll<HTMLElement>('[data-reorder-list]')).find(
          (element) =>
            element.dataset.reorderList === listId && element.getBoundingClientRect().width > 0 && !element.closest('[hidden], [inert]'),
        )
      : null;
  const nearHorizontalList = (list: HTMLElement, x: number, y: number) => {
    const { left, right, top, bottom } = list.getBoundingClientRect();
    const dragRight = Math.max(right, listBounds.right + trailingRoom);
    return x >= left - 12 && x <= dragRight + 12 && y >= top - 8 && y <= bottom + 8;
  };
  const updateTarget = (x: number, y: number) => {
    const list = findHorizontalList();
    if (list && !nearHorizontalList(list, x, y)) {
      clearDwell();
      useListReorder.getState().hover(null);
      return;
    }
    if (axis === 'horizontal' && grouped && list && dimensions.origin && listBounds.width > 0) {
      const previewLeft = horizontalPreviewLeft(x, dimensions.origin);
      const leading = x - dimensions.origin.offsetX - listBounds.left + list.scrollLeft;
      const centerX = previewLeft + (dimensions.width ?? 0) / 2;
      // The empty tail of a grouped list keeps its own zone: dropping there leaves the group.
      const centerZone = document.elementFromPoint(centerX, y)?.closest<HTMLElement>('[data-reorder-zone]');
      const emptyZone =
        centerZone && list.contains(centerZone) && match(item.kind, centerZone.dataset.reorderKind ?? '')
          ? centerZone.dataset.reorderZone
          : undefined;
      // A collapsed group accepts the drop only after the pointer dwells on its label.
      const pointerZone = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-reorder-zone]');
      const pointerZoneId = pointerZone && list.contains(pointerZone) ? pointerZone.dataset.reorderZone : undefined;
      let dwell: string | undefined;
      if (pointerZoneId && match(item.kind, 'group')) {
        const label = units.find((candidate) => candidate.id === pointerZoneId && candidate.kind === 'group');
        const hasMembers = units.some((candidate) => candidate.zoneId === pointerZoneId && candidate.kind !== 'group');
        if (label && !hasMembers) dwell = pointerZoneId;
      }
      let index = units.length;
      for (let i = 0; i < units.length; i++)
        if (leading < units[i]!.mid) {
          index = i;
          break;
        }
      const unit = units[index];
      // A member tab dragged out of its group can leave through the empty tail even while
      // its leading edge still overlaps the group; a loose tab follows the midpoint scan.
      let resolved: ListReorderTarget | null;
      if (!unit) {
        const last = units[units.length - 1];
        if (emptyZone && !units.some((candidate) => candidate.zoneId === emptyZone)) resolved = { zoneId: emptyZone };
        // Past the last member's midpoint but still inside the group: append to the group.
        else if (last && last.kind === 'tab' && last.zoneId && leading < last.right) resolved = { itemId: last.id, after: true };
        // A trailing collapsed group keeps the tab beside it, never inside it.
        else if (last && last.kind === 'group') resolved = { itemId: last.id, after: true };
        else resolved = endTarget;
      } else if (emptyZone && sourceZone && !units.some((candidate) => candidate.zoneId === emptyZone)) {
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
        if (dwellFired && dwellZone === dwell) {
          useListReorder.getState().hover({ zoneId: dwell });
          return;
        }
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
      if (list !== currentList) {
        list.scrollLeft = scrollLeft;
        currentList = list;
      }
      const bounds = list.getBoundingClientRect();
      if (dimensions.origin && sourceIndex >= 0 && listBounds.width > 0) {
        // Compare the moving edges against stable slots, independent of the pointer's grab offset and the rendered gap.
        const left = x - dimensions.origin.offsetX - bounds.left + list.scrollLeft;
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
        const next = horizontalSlots[insertionIndex];
        const last = horizontalSlots[horizontalSlots.length - 1];
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
    if (!dimensions.origin || !direction || !nearHorizontalList(list, pointer.x, pointer.y)) return 0;
    const bounds = list.getBoundingClientRect();
    const distance = direction > 0 ? bounds.right - pointer.x : pointer.x - bounds.left;
    return direction * 720 * Math.max(0, Math.min(1, (24 - distance) / 24));
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
    if (!list || !active) {
      stopScrolling();
      return;
    }
    const elapsed = scrollTime === undefined ? 16 : Math.min(32, time - scrollTime);
    scrollTime = time;
    list.scrollLeft = Math.max(0, Math.min(list.scrollWidth - list.clientWidth, list.scrollLeft + (scrollVelocity(list) * elapsed) / 1000));
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
  return {
    drag,
    scrollLeft,
    start: (at: ReorderPoint) => {
      active = true;
      closeActiveMenu();
      window.dispatchEvent(new Event('list-reorder-start'));
      useListReorder.getState().start(drag, at);
    },
    move: preview,
    stop: () => {
      active = false;
      stopScrolling();
      clearDwell();
    },
  };
}

interface ListReorderSession {
  move: (point: ReorderPoint) => void;
  finish: () => void;
  cancel: () => void;
}
const registeredReorderLists = new WeakMap<
  HTMLElement,
  (id: string, point: ReorderPoint, grabRatio?: number) => ListReorderSession | undefined
>();

export function startHeldListReorder(list: HTMLElement, id: string, point: ReorderPoint, grabRatio?: number) {
  return registeredReorderLists.get(list)?.(id, point, grabRatio);
}

export type ListReorderEnd = 'released' | 'canceled' | 'capture-lost';

/** Pointer gesture shared by horizontal and vertical lists. */
export function useListReorderDrag({
  listId,
  accepts,
  onStart,
  onDrop,
  onDragMove,
  onDragEnd,
  onDropOutside,
  axis = 'vertical',
  grouped = false,
  endZoneId,
  edgeDrop = false,
  listRef,
}: {
  listId: string;
  listRef?: RefObject<HTMLElement | null>;
  axis?: 'vertical' | 'horizontal';
  /** Resolve horizontal destinations within their group or empty drop zone. */
  grouped?: boolean;
  /** Zone that receives an item dropped past the last unit of a grouped horizontal list. */
  endZoneId?: string;
  /** Accept drops past a vertical list's first/last row in the surrounding empty area. */
  edgeDrop?: boolean;
  /** Item-kind matcher; defaults to "same kind only". */
  accepts?: (dragKind: string, itemKind: string) => boolean;
  onStart?: (item: ListReorderDrag, event: PointerEvent) => boolean | void;
  onDragMove?: (drag: ListReorderDrag, event: PointerEvent) => void;
  onDragEnd?: (id: string, reason: ListReorderEnd) => void;
  onDrop: (drag: ListReorderDrag, target: ListReorderTarget | null) => void;
  onDropOutside?: (drag: ListReorderDrag, event: PointerEvent) => boolean;
}) {
  const cleanupRef = useRef<(() => void) | null>(null);
  const dropRef = useRef(onDrop);
  dropRef.current = onDrop;
  const acceptsRef = useRef(accepts);
  acceptsRef.current = accepts;
  const match = (dragKind: string, itemKind: string) => acceptsRef.current?.(dragKind, itemKind) ?? dragKind === itemKind;
  const options = { listId, axis, grouped, endZoneId, edgeDrop, match };
  const optionsRef = useRef(options);
  optionsRef.current = options;
  useLayoutEffect(() => {
    const list = listRef?.current;
    if (!list) return;
    registeredReorderLists.set(list, (id, point, grabRatio) => {
      const row = Array.from(list.querySelectorAll<HTMLElement>('[data-reorder-item]')).find((row) => row.dataset.reorderItem === id);
      const kind = row?.dataset.reorderKind;
      if (!row || !kind) return;
      const motion = createListReorderMotion(row, { id, kind }, point, optionsRef.current, grabRatio);
      motion.start(point);
      const move = ({ x, y }: ReorderPoint) => motion.move(x, y);
      move(point);
      const cancel = () => {
        motion.stop();
        if (useListReorder.getState().drag === motion.drag) useListReorder.getState().end();
      };
      return {
        move,
        cancel,
        finish: () => {
          try {
            const state = useListReorder.getState();
            if (state.drag === motion.drag) dropRef.current(motion.drag, state.target);
          } finally {
            cancel();
          }
        },
      };
    });
    return () => {
      registeredReorderLists.delete(list);
    };
  }, [listRef]);
  useEffect(
    () => () => {
      const state = useListReorder.getState();
      const transferring =
        (state.pendingScroll?.listId === listId || state.drag?.listId === listId) &&
        Array.from(document.querySelectorAll<HTMLElement>('[data-reorder-list]')).some(
          (element) =>
            element.dataset.reorderList === listId && !element.closest('[hidden], [inert]') && element.getBoundingClientRect().width > 0,
        );
      // Resource-specific headers may hand the same logical list to a new visible host on press.
      // Its captured gesture owns the listeners until release, cancellation or window blur.
      if (!transferring) cleanupRef.current?.();
    },
    [listId],
  );

  return (event: ReactPointerEvent<HTMLElement>, item: { id: string; kind: string }) => {
    if (event.button !== 0 || event.isPrimary === false) return;
    // Rows stay clickable: inputs, action buttons and opt-out nodes never start a drag.
    const target = event.target as HTMLElement;
    if (target.closest('input, [data-no-drag]') || (target.closest('button') && !target.closest('[data-reorder-handle]'))) return;
    event.stopPropagation();
    cleanupRef.current?.();
    const source = target.closest<HTMLElement>('[data-reorder-handle]') ?? event.currentTarget;
    const { pointerId, clientX, clientY } = event;
    const motion = createListReorderMotion(event.currentTarget, item, { x: clientX, y: clientY }, options);
    const { drag, scrollLeft } = motion;
    useListReorder.getState().prepare({ listId, scrollLeft });
    // A tab press can replace its header; the captured gesture retains its original drop handler.
    const drop = dropRef.current;
    let started = false;
    let canceled = false;
    let nativeDrag = false;
    let clickTimer: ReturnType<typeof setTimeout> | undefined;
    let capture = source;
    capture.setPointerCapture?.(pointerId);
    const move = (next: PointerEvent) => {
      if (next.pointerId !== pointerId || canceled) return;
      if (!started && Math.hypot(next.clientX - clientX, next.clientY - clientY) < 6) return;
      if (!started) {
        started = true;
        if (onStart) {
          // Selecting a tab can unmount its header. Keep the drag captured by the document.
          capture = document.documentElement;
          capture.setPointerCapture?.(pointerId);
          if (onStart(drag, next) === true) {
            nativeDrag = true;
            clean('canceled');
            return;
          }
        }
        motion.start({ x: next.clientX, y: next.clientY });
      }
      next.preventDefault();
      motion.move(next.clientX, next.clientY);
      onDragMove?.(drag, next);
    };
    const suppressClick = (next: MouseEvent) => {
      if ((started || canceled) && (!nativeDrag || next.detail > 0)) {
        next.preventDefault();
        next.stopImmediatePropagation();
      }
    };
    const removeClick = () => {
      window.removeEventListener('click', suppressClick, true);
      window.removeEventListener('pointerdown', removeClick, true);
      window.removeEventListener('pointerup', afterNativeRelease, true);
    };
    const afterNativeRelease = (event: PointerEvent) => {
      if (event.pointerId === pointerId) clickTimer = setTimeout(removeClick, 0);
    };
    const clean = (reason: ListReorderEnd) => {
      motion.stop();
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', loseCapture, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', loseCapture);
      if (capture.hasPointerCapture?.(pointerId)) capture.releasePointerCapture(pointerId);
      useListReorder.getState().end();
      if (started) onDragEnd?.(item.id, reason);
      if (nativeDrag) {
        // The native move starts before pointerup. Protect the original row until release or a new press.
        window.addEventListener('pointerup', afterNativeRelease, true);
        window.addEventListener('pointerdown', removeClick, true);
      } else {
        // Pointerup produces a click synchronously; keep that click from activating the row.
        clickTimer = setTimeout(removeClick, 0);
      }
      cleanupRef.current = () => {
        clearTimeout(clickTimer);
        removeClick();
      };
    };
    const up = (next: PointerEvent) => {
      if (next.pointerId !== pointerId) return;
      if (started && !canceled) {
        motion.move(next.clientX, next.clientY);
        if (!onDropOutside?.(drag, next)) drop(drag, useListReorder.getState().target);
      }
      clean('released');
    };
    const loseCapture = () => clean('capture-lost');
    const key = (next: KeyboardEvent) => {
      if (next.key === 'Escape') {
        next.preventDefault();
        next.stopImmediatePropagation();
        if (next.repeat) return;
        canceled = true;
        motion.stop();
        useListReorder.getState().end();
        if (started) onDragEnd?.(item.id, 'canceled');
        // Keep capture until release so cancellation cannot turn into a row click.
      }
    };
    window.addEventListener('pointermove', move, { capture: true, passive: false });
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', loseCapture, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('blur', loseCapture);
    window.addEventListener('click', suppressClick, true);
    cleanupRef.current = () => {
      clean('canceled');
      clearTimeout(clickTimer);
      removeClick();
    };
  };
}

/** Insertion gap rendered before or after the hovered item. */
export function ListReorderPlaceholder({
  listId,
  itemId,
  after = false,
  reserveSource = false,
  children,
}: {
  listId: string;
  itemId: string;
  after?: boolean;
  /** Keep the dragged row's own slot while no destination is resolved, so adjacent content cannot shift. */
  reserveSource?: boolean;
  children?: ReactNode;
}) {
  const show = useListReorder((state) => {
    if (!state.drag || state.drag.listId !== listId) return false;
    if (state.target) return state.target.itemId === itemId && !!state.target.after === after;
    return reserveSource && !after && state.drag.id === itemId;
  });
  const height = useListReorder((state) => state.drag?.height);
  const width = useListReorder((state) => state.drag?.width);
  return show ? (
    <div
      className="sidebar-reorder-placeholder"
      style={{ height, width }}
      data-reorder-placeholder={itemId}
      aria-hidden="true"
      inert={!!children}>
      {children}
    </div>
  ) : null;
}

/** Empty and collapsed groups remain available as append destinations. */
export function ListReorderZonePlaceholder({ listId, zoneId, children }: { listId: string; zoneId: string; children?: ReactNode }) {
  const show = useListReorder((state) => !!state.drag && state.drag.listId === listId && state.target?.zoneId === zoneId);
  const height = useListReorder((state) => state.drag?.height);
  const width = useListReorder((state) => state.drag?.width);
  return show ? (
    <div
      className="sidebar-reorder-placeholder"
      style={{ height, width }}
      data-reorder-placeholder={zoneId}
      aria-hidden="true"
      inert={!!children}>
      {children}
    </div>
  ) : null;
}

/** A preview follows the pointer without intercepting drop targets. */
export function ListReorderPreview({
  listId,
  variant = 'icon',
  className = '',
  children,
  owner,
  followsPointer,
}: {
  listId: string;
  variant?: 'icon' | 'item';
  className?: string;
  children: (drag: ListReorderDrag) => ReactNode;
  owner?: { readonly current: HTMLElement | null };
  followsPointer?: (drag: ListReorderDrag, position: { x: number; y: number }) => boolean;
}) {
  const drag = useListReorder((state) => (state.drag?.listId === listId ? state.drag : null));
  const position = useListReorder((state) => state.position);
  const content = useMemo(() => (drag ? children(drag) : null), [drag, children]);
  if (!drag || !position || owner?.current?.closest('[hidden], [inert]')) return null;
  const floating = followsPointer?.(drag, position);
  const inside = (value: number, extent: number, length = 0) => Math.max(4, Math.min(value, extent - length - 4));
  const style =
    variant === 'item' && drag.origin
      ? {
          left: 0,
          top: 0,
          transform: floating
            ? `translate3d(${inside(position.x - drag.origin.offsetX, window.innerWidth, drag.width)}px, ${inside(position.y - drag.origin.offsetY, window.innerHeight, drag.height)}px, 0)`
            : `translate3d(${horizontalPreviewLeft(position.x, drag.origin)}px, ${drag.origin.top}px, 0)`,
          width: drag.width,
          height: drag.height,
        }
      : { left: 0, top: 0, transform: `translate3d(${position.x}px, ${position.y}px, 0) translate(-50%, -50%)` };
  return createPortal(
    <div
      className={`${variant === 'item' ? 'list-reorder-item-preview' : 'sidebar-reorder-preview'}${className ? ` ${className}` : ''}`}
      data-reorder-preview={variant}
      data-detaching={floating || undefined}
      aria-hidden="true"
      inert
      style={style}>
      {content}
    </div>,
    document.body,
  );
}
