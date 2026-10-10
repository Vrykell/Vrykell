import { useLayoutEffect, useRef, type RefObject } from 'react';

let activeMenu: { id: symbol; close: () => void } | null = null;

/** Independent action menus replace each other, including right-click openings. */
export function useExclusiveMenu(ref: RefObject<HTMLElement | null>, onClose: () => void) {
  const id = useRef(Symbol('action-menu'));
  const close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    const previous = activeMenu;
    activeMenu = { id: id.current, close: () => close.current() };
    previous?.close();
    const dismiss = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) close.current();
    };
    document.addEventListener('pointerdown', dismiss, true);
    return () => {
      if (activeMenu?.id === id.current) activeMenu = null;
      document.removeEventListener('pointerdown', dismiss, true);
    };
  }, [ref]);
}
