import { useEffect, useRef, useState, type RefObject, type PointerEvent } from 'react';
import { scrollbarGeometry, scrollbarOffset } from './scrollbarGeometry';

interface Props {
  scrollRef: RefObject<HTMLElement | null>;
  controlsId: string;
  label: string;
}

/** A transparent overlay for an ordinary DOM scroll surface. */
export default function OverlayScrollbar({ scrollRef, controlsId, label }: Props) {
  const [geometry, setGeometry] = useState(() => scrollbarGeometry(0, 0, 0));
  const drag = useRef<{ pointer: number; offset: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const update = () => {
      const next = scrollbarGeometry(scroll.clientHeight, scroll.scrollHeight, scroll.scrollTop);
      setGeometry(previous => previous.maximum === next.maximum && previous.height === next.height
        && previous.travel === next.travel && previous.value === next.value ? previous : next);
    };
    const observer = new ResizeObserver(update);
    observer.observe(scroll);
    if (scroll.firstElementChild) observer.observe(scroll.firstElementChild);
    scroll.addEventListener('scroll', update, { passive: true });
    update();
    return () => {
      observer.disconnect();
      scroll.removeEventListener('scroll', update);
    };
  }, [scrollRef]);

  const move = (event: PointerEvent<HTMLDivElement>, offset: number) => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const current = scrollbarGeometry(scroll.clientHeight, scroll.scrollHeight, scroll.scrollTop);
    scroll.scrollTop = scrollbarOffset(event.clientY - event.currentTarget.getBoundingClientRect().top - offset, current);
  };

  if (geometry.maximum === 0) return null;
  return <div
    className="overlay-scrollbar"
    data-no-drag
    data-dragging={dragging}
    role="scrollbar"
    tabIndex={0}
    aria-label={label}
    aria-controls={controlsId}
    aria-orientation="vertical"
    aria-valuemin={0}
    aria-valuemax={geometry.maximum}
    aria-valuenow={Math.round(geometry.value)}
    onPointerDown={event => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.focus({ preventScroll: true });
      const offset = event.target === event.currentTarget ? geometry.height / 2
        : event.clientY - event.currentTarget.getBoundingClientRect().top - geometry.top;
      drag.current = { pointer: event.pointerId, offset };
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragging(true);
      move(event, offset);
    }}
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
      if (scroll) scroll.scrollTop += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? scroll.clientHeight : 1);
      event.stopPropagation();
    }}
    onKeyDown={event => {
      const scroll = scrollRef.current;
      if (!scroll) return;
      let next: number;
      switch (event.key) {
        case 'ArrowUp': next = scroll.scrollTop - 40; break;
        case 'ArrowDown': next = scroll.scrollTop + 40; break;
        case 'PageUp': next = scroll.scrollTop - scroll.clientHeight; break;
        case 'PageDown': next = scroll.scrollTop + scroll.clientHeight; break;
        case 'Home': next = 0; break;
        case 'End': next = geometry.maximum; break;
        default: return;
      }
      event.preventDefault();
      event.stopPropagation();
      scroll.scrollTop = next;
    }}
  >
    <div className="overlay-scrollbar-thumb" style={{ height: geometry.height, transform: `translateY(${geometry.top}px)` }} />
  </div>;
}
