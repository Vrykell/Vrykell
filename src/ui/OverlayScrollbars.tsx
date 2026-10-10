import { useEffect, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { t } from '@i18n';
import OverlayScrollbar from './OverlayScrollbar';

const candidates = 'textarea, [style*="overflow"], .scroll-region, .settings-content, .ui-select-menu, .directory-picker-list, .global-search-body, .md pre, .md .katex-display';
interface Surface { element: HTMLElement; ref: RefObject<HTMLElement>; id: string; horizontal: boolean; vertical: boolean; }

/** Share overlay tracks across scroll surfaces without changing their DOM or layout. */
export default function OverlayScrollbars() {
  const [surfaces, setSurfaces] = useState<Surface[]>([]);
  useEffect(() => {
    const known = new Map<HTMLElement, Surface>();
    let sequence = 0;
    let frame = 0;
    const scan = () => {
      frame = 0;
      const found = new Set<HTMLElement>();
      for (const element of document.querySelectorAll<HTMLElement>(candidates)) {
        if (element.closest('.xterm, .terminal-block-scroll, [data-scroll-overlay-layer]')) continue;
        const style = getComputedStyle(element);
        const horizontal = ['auto', 'scroll'].includes(style.overflowX);
        const vertical = ['auto', 'scroll'].includes(style.overflowY);
        if (!horizontal && !vertical) continue;
        found.add(element);
        const existing = known.get(element);
        if (!existing || existing.horizontal !== horizontal || existing.vertical !== vertical) {
          const id = element.id || `overlay-scroll-surface-${++sequence}`;
          if (!element.id) element.id = id;
          known.set(element, { element, ref: { current: element }, id, horizontal, vertical });
        }
        if (!element.classList.contains('overlay-scroll-target')) element.classList.add('overlay-scroll-target');
      }
      let removed = false;
      for (const [element] of known) if (!found.has(element)) {
        element.classList.remove('overlay-scroll-target');
        known.delete(element);
        removed = true;
      }
      const next = [...known.values()];
      setSurfaces(previous => !removed && previous.length === next.length && previous.every((item, index) => item === next[index]) ? previous : next);
      window.dispatchEvent(new Event('overlay-scroll-layout'));
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(scan); };
    const observer = new MutationObserver(records => {
      if (records.some(record => !(record.target instanceof Element && record.target.closest('[data-scroll-overlay-layer]')))) schedule();
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style'] });
    document.addEventListener('input', schedule);
    scan();
    return () => {
      document.removeEventListener('input', schedule);
      observer.disconnect();
      cancelAnimationFrame(frame);
      for (const element of known.keys()) element.classList.remove('overlay-scroll-target');
    };
  }, []);
  return createPortal(<div data-scroll-overlay-layer>{surfaces.map(surface => <div key={surface.id}>
    {surface.vertical && <OverlayScrollbar floating scrollRef={surface.ref} controlsId={surface.id} label={t('Scroll content')} />}
    {surface.horizontal && <OverlayScrollbar floating horizontal scrollRef={surface.ref} controlsId={surface.id} label={t('Scroll content horizontally')} />}
  </div>)}</div>, document.body);
}
