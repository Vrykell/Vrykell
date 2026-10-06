import { useLayoutEffect, type RefObject } from 'react';

/** Reserve equal space on both sides of the search field as actions change width. */
export function useBalancedTitlebar(headerRef: RefObject<HTMLElement | null>, actionsRef: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const header = headerRef.current;
    const actions = actionsRef.current;
    if (!header || !actions) return;
    const measure = () => header.style.setProperty('--workspace-actions-width', `${Math.ceil(actions.getBoundingClientRect().width)}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(actions);
    return () => observer.disconnect();
  }, [headerRef, actionsRef]);
}
