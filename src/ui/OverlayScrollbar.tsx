import { useEffect, useRef, useState, type RefObject, type PointerEvent, type CSSProperties } from 'react';
import { scrollbarGeometry, scrollbarOffset } from './scrollbarGeometry';

const TRACK_INSET = 4;

interface Props {
  scrollRef: RefObject<HTMLElement | null>;
  controlsId: string;
  label: string;
  horizontal?: boolean;
  floating?: boolean;
  /** Element owning the floating layer; its coordinate space is used so transforms keep the track aligned. */
  layerHost?: HTMLElement;
}

/** A transparent overlay for an ordinary DOM scroll surface. */
export default function OverlayScrollbar({ scrollRef, controlsId, label, horizontal = false, floating = false, layerHost }: Props) {
  const [geometry, setGeometry] = useState(() => scrollbarGeometry(0, 0, 0));
  const drag = useRef<{ pointer: number; offset: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [placement, setPlacement] = useState<CSSProperties>({});
  const readGeometry = (scroll: HTMLElement) => scrollbarGeometry(
    horizontal ? scroll.clientWidth : scroll.clientHeight,
    horizontal ? scroll.scrollWidth : scroll.scrollHeight,
    horizontal ? scroll.scrollLeft : scroll.scrollTop,
    Math.max(0, (horizontal ? scroll.clientWidth : scroll.clientHeight) - TRACK_INSET * 2),
  );

  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const update = () => {
      const next = readGeometry(scroll);
      setGeometry(previous => previous.maximum === next.maximum && previous.height === next.height
        && previous.travel === next.travel && previous.value === next.value ? previous : next);
      if (floating) {
        const rect = scroll.getBoundingClientRect();
        const top = rect.top + scroll.clientTop;
        const left = rect.left + scroll.clientLeft;
        let clipTop = Math.max(0, -top);
        let clipLeft = Math.max(0, -left);
        let clipBottom = Math.max(0, top + scroll.clientHeight - window.innerHeight);
        let clipRight = Math.max(0, left + scroll.clientWidth - window.innerWidth);
        const ownedLayer = !!layerHost && layerHost !== document.body;
        let zIndex = ownedLayer ? 1 : Math.max(2, (parseInt(getComputedStyle(scroll).zIndex) || 0) + 1);
        for (let parent = scroll.parentElement; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent);
          if (!ownedLayer) zIndex = Math.max(zIndex, (parseInt(style.zIndex) || 0) + 1);
          const bounds = parent.getBoundingClientRect();
          if (['auto', 'scroll', 'hidden', 'clip'].includes(style.overflowY)) {
            clipTop = Math.max(clipTop, bounds.top + parent.clientTop - top);
            clipBottom = Math.max(clipBottom, top + scroll.clientHeight - bounds.top - parent.clientTop - parent.clientHeight);
          }
          if (['auto', 'scroll', 'hidden', 'clip'].includes(style.overflowX)) {
            clipLeft = Math.max(clipLeft, bounds.left + parent.clientLeft - left);
            clipRight = Math.max(clipRight, left + scroll.clientWidth - bounds.left - parent.clientLeft - parent.clientWidth);
          }
        }
        const nextPlacement: CSSProperties = horizontal
          ? { position: 'fixed', top: top + scroll.clientHeight - 10, left, width: scroll.clientWidth, height: 10,
            bottom: 'auto', right: 'auto', clipPath: `inset(0 ${Math.max(0, clipRight)}px 0 ${Math.max(0, clipLeft)}px)`, zIndex }
          : { position: 'fixed', top, left: left + scroll.clientWidth - 10, width: 10, height: scroll.clientHeight,
            bottom: 'auto', right: 'auto', clipPath: `inset(${Math.max(0, clipTop)}px 0 ${Math.max(0, clipBottom)}px 0)`, zIndex };
        if (ownedLayer) {
          // The layer lives in the host's coordinate space, which may be transformed, so map viewport pixels into it.
          const hostBounds = layerHost.getBoundingClientRect();
          const scaleX = layerHost.offsetWidth > 0 ? hostBounds.width / layerHost.offsetWidth || 1 : 1;
          const scaleY = layerHost.offsetHeight > 0 ? hostBounds.height / layerHost.offsetHeight || 1 : 1;
          nextPlacement.position = 'absolute';
          nextPlacement.left = (Number(nextPlacement.left) - hostBounds.left) / scaleX - layerHost.clientLeft + layerHost.scrollLeft;
          nextPlacement.top = (Number(nextPlacement.top) - hostBounds.top) / scaleY - layerHost.clientTop + layerHost.scrollTop;
        }
        if (!scroll.getClientRects().length || (horizontal ? clipTop + clipBottom >= scroll.clientHeight : clipLeft + clipRight >= scroll.clientWidth)) nextPlacement.display = 'none';
        setPlacement(previous => JSON.stringify(previous) === JSON.stringify(nextPlacement) ? previous : nextPlacement);
      }
    };
    const observer = new ResizeObserver(update);
    observer.observe(scroll);
    if (scroll.firstElementChild) observer.observe(scroll.firstElementChild);
    scroll.addEventListener('scroll', update, { passive: true });
    if (floating) {
      window.addEventListener('scroll', update, true);
      window.addEventListener('resize', update);
      window.addEventListener('overlay-scroll-layout', update);
    }
    update();
    return () => {
      observer.disconnect();
      scroll.removeEventListener('scroll', update);
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
      window.removeEventListener('overlay-scroll-layout', update);
    };
  }, [scrollRef, horizontal, floating, layerHost]);

  const move = (event: PointerEvent<HTMLDivElement>, offset: number) => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const current = readGeometry(scroll);
    const bounds = event.currentTarget.getBoundingClientRect();
    const value = scrollbarOffset((horizontal ? event.clientX - bounds.left : event.clientY - bounds.top) - TRACK_INSET - offset, current);
    if (horizontal) scroll.scrollLeft = value;
    else scroll.scrollTop = value;
  };

  if (geometry.maximum === 0) return null;
  return <div
    className="overlay-scrollbar"
    data-horizontal={horizontal}
    style={{ ...placement, '--scrollbar-inset': `${TRACK_INSET}px` } as CSSProperties}
    data-no-drag
    data-dragging={dragging}
    role="scrollbar"
    tabIndex={floating ? -1 : 0}
    aria-label={label}
    aria-controls={controlsId}
    aria-orientation={horizontal ? 'horizontal' : 'vertical'}
    aria-valuemin={0}
    aria-valuemax={geometry.maximum}
    aria-valuenow={Math.round(geometry.value)}
    onPointerDown={event => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      if (!floating) event.currentTarget.focus({ preventScroll: true });
      const offset = event.target === event.currentTarget ? geometry.height / 2
        : (horizontal ? event.clientX - event.currentTarget.getBoundingClientRect().left
          : event.clientY - event.currentTarget.getBoundingClientRect().top) - TRACK_INSET - geometry.top;
      drag.current = { pointer: event.pointerId, offset };
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragging(true);
      move(event, offset);
    }}
    onClick={event => event.stopPropagation()}
    onPointerMove={event => {
      if (drag.current?.pointer === event.pointerId) move(event, drag.current.offset);
    }}
    onLostPointerCapture={() => { drag.current = null; setDragging(false); }}
    onPointerUp={event => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    }}
    onPointerCancel={event => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    }}
    onWheel={event => {
      const scroll = scrollRef.current;
      if (scroll && !event.ctrlKey) {
        const delta = (horizontal ? event.deltaX || event.deltaY : event.deltaY)
          * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? horizontal ? scroll.clientWidth : scroll.clientHeight : 1);
        if (horizontal) scroll.scrollLeft += delta;
        else scroll.scrollTop += delta;
      }
      event.stopPropagation();
    }}
    onKeyDown={event => {
      const scroll = scrollRef.current;
      if (!scroll) return;
      const current = horizontal ? scroll.scrollLeft : scroll.scrollTop;
      const viewport = horizontal ? scroll.clientWidth : scroll.clientHeight;
      let next: number;
      switch (event.key) {
        case 'ArrowLeft': if (!horizontal) return; next = current - 40; break;
        case 'ArrowRight': if (!horizontal) return; next = current + 40; break;
        case 'ArrowUp': if (horizontal) return; next = current - 40; break;
        case 'ArrowDown': if (horizontal) return; next = current + 40; break;
        case 'PageUp': next = current - viewport; break;
        case 'PageDown': next = current + viewport; break;
        case 'Home': next = 0; break;
        case 'End': next = geometry.maximum; break;
        default: return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (horizontal) scroll.scrollLeft = next;
      else scroll.scrollTop = next;
    }}
  >
    <div className="overlay-scrollbar-track"><div className="overlay-scrollbar-thumb" style={horizontal
      ? { width: geometry.height, transform: `translateX(${geometry.top}px)` }
      : { height: geometry.height, transform: `translateY(${geometry.top}px)` }} /></div>
  </div>;
}
