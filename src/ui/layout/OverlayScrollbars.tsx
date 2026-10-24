import { useEffect, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { t } from '@i18n';
import OverlayScrollbar from '@ui/layout/OverlayScrollbar';

const candidates = 'textarea, [style*="overflow"], .scroll-region, .settings-content, .ui-select-options, .directory-picker-list, .global-search-body, .md pre, .md table';
interface Surface { element: HTMLElement; ref: RefObject<HTMLElement>; host: HTMLElement; container: HTMLElement; id: string; horizontal: boolean; vertical: boolean; }

/** Stacking context that owns the content, so a popup track cannot escape above other overlays. */
export function scrollbarLayerHost(element: HTMLElement): HTMLElement {
  for (let owner: HTMLElement | null = element; owner && owner !== document.body; owner = owner.parentElement) {
    const style = getComputedStyle(owner);
    if (style.zIndex && style.zIndex !== 'auto' && style.position && style.position !== 'static') return owner;
  }
  return document.body;
}

/** Share overlay tracks across scroll surfaces without changing their DOM or layout. */
export default function OverlayScrollbars() {
  const [surfaces, setSurfaces] = useState<Surface[]>([]);
  useEffect(() => {
    const known = new Map<HTMLElement, Surface>();
    const layers = new Map<HTMLElement, HTMLDivElement>();
    let sequence = 0;
    let frame = 0;
    // A dedicated container keeps React portals out of React-rendered nodes while remaining inside the owning layer.
    const layerFor = (host: HTMLElement) => {
      let layer = layers.get(host);
      if (!layer) {
        layer = document.createElement('div');
        layer.setAttribute('data-scroll-overlay-layer', '');
        host.appendChild(layer);
        layers.set(host, layer);
      }
      return layer;
    };
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
        const host = scrollbarLayerHost(element);
        const container = layerFor(host);
        if (!existing || existing.host !== host || existing.horizontal !== horizontal || existing.vertical !== vertical) {
          let id = element.id;
          if (!id) {
            do { id = `overlay-scroll-surface-${++sequence}`; } while (document.getElementById(id));
            element.id = id;
          }
          known.set(element, { element, ref: existing?.ref ?? { current: element }, host, container, id, horizontal, vertical });
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
    document.addEventListener('animationend', schedule, true);
    scan();
    return () => {
      document.removeEventListener('input', schedule);
      document.removeEventListener('animationend', schedule, true);
      observer.disconnect();
      cancelAnimationFrame(frame);
      for (const element of known.keys()) element.classList.remove('overlay-scroll-target');
      for (const layer of layers.values()) layer.remove();
      layers.clear();
    };
  }, []);
  return <>{surfaces.map(surface => createPortal(<div>
    {surface.vertical && <OverlayScrollbar floating layerHost={surface.host} scrollRef={surface.ref} controlsId={surface.id} label={t('Scroll content')} />}
    {surface.horizontal && <OverlayScrollbar floating horizontal layerHost={surface.host} scrollRef={surface.ref} controlsId={surface.id} label={t('Scroll content horizontally')} />}
  </div>, surface.container, surface.id))}</>;
}
