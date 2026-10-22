import { useLayoutEffect, useRef, type RefObject } from 'react';

let activeMenu: { id: symbol; close: () => void } | null = null;

export function closeActiveMenu() { activeMenu?.close(); }

/** Controlled floating content remains part of the menu that owns its trigger. */
function controlsPopup(root: HTMLElement | null, id: string): boolean {
  return Array.from(root?.querySelectorAll('[aria-controls]') ?? [])
    .some(control => control.getAttribute('aria-controls')?.split(/\s+/).includes(id));
}

export function hasOwnedListbox(root: HTMLElement | null): boolean {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="listbox"][id]'))
    .some(listbox => controlsPopup(root, listbox.id));
}

/** Independent action menus replace each other, including right-click openings. */
export function useExclusiveMenu(ref: RefObject<HTMLElement | null>, onClose: () => void, trigger?: HTMLElement) {
  const id = useRef(Symbol('action-menu'));
  const close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    const previous = activeMenu;
    activeMenu = { id: id.current, close: () => close.current() };
    if (previous?.id !== id.current) previous?.close();
    const dismiss = (event: PointerEvent) => {
      const popup = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-floating-for], [role="listbox"]') : null;
      const id = popup?.dataset.floatingFor ?? popup?.id;
      if (id && controlsPopup(ref.current, id)) return;
      if (!ref.current?.contains(event.target as Node) && !trigger?.contains(event.target as Node)) close.current();
    };
    document.addEventListener('pointerdown', dismiss, true);
    return () => {
      if (activeMenu?.id === id.current) activeMenu = null;
      document.removeEventListener('pointerdown', dismiss, true);
    };
  }, [ref, trigger]);
}
