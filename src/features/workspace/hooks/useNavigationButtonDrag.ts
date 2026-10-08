import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { useDockStore, PANEL_DEFS, ACTIVITY_BAR_WIDTH } from '../stores/dock';
import { useNavigationDrag, type NavigationDropTarget } from '../stores/navigationDrag';
import { panelPlacementRects } from '../model/navigationPlacement';

function locateTarget(x: number, y: number, id: string): NavigationDropTarget | null {
  const hit = document.elementFromPoint(x, y);
  const area = hit?.closest<HTMLElement>('[data-dock-zone]');
  const side = area?.dataset.dockZone;
  if (!area || (side !== 'left' && side !== 'right')) {
    if (!PANEL_DEFS[id]) return null;
    const body = document.querySelector<HTMLElement>('.workspace-body')?.getBoundingClientRect();
    if (!body || y < body.top || y > body.bottom || x < body.left + ACTIVITY_BAR_WIDTH || x > body.right) return null;
    const dock = useDockStore.getState();
    const regions = panelPlacementRects(body, dock.panelWidths[id] ?? PANEL_DEFS[id]!.width);
    const destination = x <= regions.left.left + regions.left.width ? 'left'
      : x >= regions.right.left ? 'right' : null;
    if (!destination) return null;
    const zone = destination === 'left' ? dock.leftZone : dock.rightZone;
    return { side: destination, index: zone.includes(id) ? zone.indexOf(id) : zone.length, openPanel: true };
  }
  const dock = useDockStore.getState();
  const zone = side === 'left' ? dock.leftZone : dock.rightZone;
  const placeholder = hit?.closest<HTMLElement>('[data-dock-placeholder]');
  if (placeholder && area.contains(placeholder)) return { side, index: Number(placeholder.dataset.dockPlaceholder) };
  const slot = hit?.closest<HTMLElement>('[data-dock-slot]');
  if (!slot || !area.contains(slot)) {
    // Gaps between controls belong to the next insertion boundary, not the end.
    for (const candidate of area.querySelectorAll<HTMLElement>('[data-dock-slot]:not([data-moving="true"])')) {
      const rect = candidate.getBoundingClientRect();
      if ((side === 'left' ? y < rect.top + rect.height / 2 : x < rect.left + rect.width / 2)) {
        return { side, index: zone.indexOf(candidate.dataset.dockSlot!) };
      }
    }
    return { side, index: zone.length };
  }
  const index = zone.indexOf(slot.dataset.dockSlot!);
  const rect = slot.getBoundingClientRect();
  const after = side === 'left' ? y > rect.top + rect.height / 2 : x > rect.left + rect.width / 2;
  return { side, index: index + (after ? 1 : 0) };
}

/** Pointer gestures work alongside the native file-drop handler in desktop webviews. */
export function useNavigationButtonDrag() {
  const cleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanupRef.current?.(), []);

  return (event: ReactPointerEvent<HTMLButtonElement>, id: string) => {
    if (event.button !== 0 || event.isPrimary === false) return;
    event.stopPropagation();
    cleanupRef.current?.();
    const source = event.currentTarget;
    const { pointerId, clientX, clientY } = event;
    let started = false;
    let canceled = false;
    let clickTimer: ReturnType<typeof setTimeout> | undefined;
    source.setPointerCapture?.(pointerId);

    const preview = (x: number, y: number) => {
      useNavigationDrag.getState().movePointer(x, y);
      const target = locateTarget(x, y, id);
      if (target) useNavigationDrag.getState().hover(target.side, target.index, target.openPanel);
      else useNavigationDrag.setState({ target: null });
    };
    const move = (next: PointerEvent) => {
      if (next.pointerId !== pointerId || canceled) return;
      if (!started && Math.hypot(next.clientX - clientX, next.clientY - clientY) < 6) return;
      if (!started) {
        started = true;
        useNavigationDrag.getState().start(id, { x: next.clientX, y: next.clientY });
      }
      next.preventDefault();
      preview(next.clientX, next.clientY);
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
      if (started) useNavigationDrag.getState().end();
      // Pointerup produces a click synchronously; keep that click from toggling a panel.
      clickTimer = setTimeout(removeClick, 0);
      cleanupRef.current = () => { clearTimeout(clickTimer); removeClick(); };
    };
    const up = (next: PointerEvent) => {
      if (next.pointerId !== pointerId) return;
      if (started && !canceled) {
        preview(next.clientX, next.clientY);
        const target = useNavigationDrag.getState().target;
        if (target) {
          useDockStore.getState().moveButton(id, target.side, target.index);
          if (target.openPanel) useDockStore.getState().openPanel(id);
        }
      }
      clean();
    };
    const cancel = () => clean();
    const key = (next: KeyboardEvent) => {
      if (next.key === 'Escape') {
        next.preventDefault();
        next.stopImmediatePropagation();
        canceled = true;
        useNavigationDrag.getState().end();
        // Keep capture until release so cancellation cannot turn into a button click.
      }
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
