import { useLayoutEffect, type RefObject } from 'react';
import { globalSearchLayout } from '../model/titlebarLayout';

/** Keep the search centered in the application as navigation, controls and native insets change. */
export function useBalancedTitlebar(headerRef: RefObject<HTMLElement | null>, actionsRef: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const header = headerRef.current;
    const actions = actionsRef.current;
    if (!header || !actions) return;
    const title = header.querySelector<HTMLElement>('.workspace-title');
    const measure = () => {
      const bounds = header.getBoundingClientRect();
      const width = Math.ceil(actions.getBoundingClientRect().width);
      const expand = title?.querySelector<HTMLElement>('button');
      const leftReserved = (title ? parseFloat(getComputedStyle(title).paddingLeft) || 0 : 0)
        + (expand ? expand.getBoundingClientRect().width + (parseFloat(getComputedStyle(expand).marginRight) || 0) : 0);
      const gap = parseFloat(getComputedStyle(header).getPropertyValue('--workspace-title-gap')) || 12;
      const layout = globalSearchLayout({ viewportWidth: window.innerWidth, headerLeft: bounds.left, headerWidth: bounds.width, actionsWidth: width, leftReserved, gap });
      header.style.setProperty('--workspace-actions-width', `${width}px`);
      header.style.setProperty('--workspace-search-width', `${layout.width}px`);
      header.style.setProperty('--workspace-title-space', `${layout.titleSpace}px`);
      header.style.setProperty('--workspace-search-gap', `${layout.gap}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(actions);
    observer.observe(header);
    if (title) observer.observe(title);
    window.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, [headerRef, actionsRef]);
}
