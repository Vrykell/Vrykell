import { useLayoutEffect, useRef, type RefObject } from 'react';

let activeMenu: { id: symbol; close: () => void } | null = null;

export function closeActiveMenu() { activeMenu?.close(); }

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
      const listbox = event.target instanceof Element ? event.target.closest('[role="listbox"]') : null;
      // A select owns its portaled list through the control's accessibility relation.
      if (listbox?.id && Array.from(ref.current?.querySelectorAll('[aria-controls]') ?? [])
        .some(control => control.getAttribute('aria-controls') === listbox.id)) return;
      if (!ref.current?.contains(event.target as Node) && !trigger?.contains(event.target as Node)) close.current();
    };
    document.addEventListener('pointerdown', dismiss, true);
    return () => {
      if (activeMenu?.id === id.current) activeMenu = null;
      document.removeEventListener('pointerdown', dismiss, true);
    };
  }, [ref, trigger]);
}
