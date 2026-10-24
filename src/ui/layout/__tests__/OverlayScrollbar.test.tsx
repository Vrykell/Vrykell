import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import OverlayScrollbar from '@ui/layout/OverlayScrollbar';

let resized: () => void;
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resized = callback; }
    observe() {}
    disconnect() {}
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function surface(height: number, extent: number, top = 0) {
  const scroll = document.createElement('div');
  const dimensions = { height, extent };
  Object.defineProperties(scroll, {
    clientHeight: { get: () => dimensions.height },
    scrollHeight: { get: () => dimensions.extent },
  });
  scroll.scrollTop = top;
  render(<OverlayScrollbar scrollRef={{ current: scroll }} controlsId="history" label="Scroll history" />);
  return { scroll, dimensions };
}

it('appears on overflow and updates its accessible position after content resizing and scrolling', () => {
  const { scroll, dimensions } = surface(200, 200);
  expect(screen.queryByRole('scrollbar')).toBeNull();
  dimensions.extent = 1000;
  act(() => resized());
  const bar = screen.getByRole('scrollbar', { name: 'Scroll history' });
  expect(bar).toHaveAttribute('aria-controls', 'history');
  expect(bar).toHaveAttribute('aria-valuemax', '800');
  scroll.scrollTop = 400;
  fireEvent.scroll(scroll);
  expect(bar).toHaveAttribute('aria-valuenow', '400');
  dimensions.extent = 100;
  act(() => resized());
  expect(screen.queryByRole('scrollbar')).toBeNull();
});

it('reveals only while the pointer is over the surface or its track', () => {
  const { scroll } = surface(200, 1000);
  const bar = screen.getByRole('scrollbar');
  expect(bar).toHaveAttribute('data-visible', 'false');
  fireEvent.pointerEnter(scroll);
  expect(bar).toHaveAttribute('data-visible', 'true');
  // Crossing from the content onto the track keeps the thumb visible.
  fireEvent.pointerLeave(scroll, { relatedTarget: bar });
  expect(bar).toHaveAttribute('data-visible', 'true');
  fireEvent.pointerLeave(bar);
  expect(bar).toHaveAttribute('data-visible', 'false');
  fireEvent.pointerEnter(bar);
  expect(bar).toHaveAttribute('data-visible', 'true');
  fireEvent.pointerLeave(bar);
  expect(bar).toHaveAttribute('data-visible', 'false');
});

it('navigates history by keyboard and forwards wheel input over the transparent track', () => {
  const { scroll } = surface(200, 1000, 400);
  const bar = screen.getByRole('scrollbar');
  fireEvent.keyDown(bar, { key: 'Home' });
  expect(scroll.scrollTop).toBe(0);
  fireEvent.keyDown(bar, { key: 'End' });
  expect(scroll.scrollTop).toBe(800);
  fireEvent.keyDown(bar, { key: 'PageUp' });
  expect(scroll.scrollTop).toBe(600);
  fireEvent.keyDown(bar, { key: 'ArrowUp' });
  expect(scroll.scrollTop).toBe(560);
  fireEvent.wheel(bar, { deltaY: -2, deltaMode: 1 });
  expect(scroll.scrollTop).toBe(528);
});

it('supports horizontal content without changing vertical position', () => {
  const scroll = document.createElement('div');
  Object.defineProperties(scroll, { clientWidth: { value: 200 }, scrollWidth: { value: 1000 } });
  render(<OverlayScrollbar horizontal scrollRef={{ current: scroll }} controlsId="code" label="Scroll code" />);
  const bar = screen.getByRole('scrollbar');
  expect(bar).toHaveAttribute('aria-orientation', 'horizontal');
  fireEvent.keyDown(bar, { key: 'End' });
  expect(scroll.scrollLeft).toBe(800);
  fireEvent.keyDown(bar, { key: 'ArrowLeft' });
  expect(scroll.scrollLeft).toBe(760);
  fireEvent.wheel(bar, { deltaX: -60 });
  expect(scroll.scrollLeft).toBe(700);
  expect(scroll.scrollTop).toBe(0);
});

it('places floating tracks above the scroll surface itself', () => {
  const scroll = document.createElement('div');
  scroll.style.zIndex = '400';
  Object.defineProperties(scroll, {
    clientWidth: { value: 300 }, scrollWidth: { value: 900 }, clientHeight: { value: 70 },
    getClientRects: { value: () => [new DOMRect(300, 120, 300, 70)] },
    getBoundingClientRect: { value: () => new DOMRect(300, 120, 300, 70) },
  });
  render(<OverlayScrollbar horizontal floating scrollRef={{ current: scroll }} controlsId="floating" label="Scroll content" />);
  expect(screen.getByRole('scrollbar')).toHaveAttribute('tabindex', '-1');
  expect(screen.getByRole('scrollbar')).toHaveStyle({ position: 'fixed', zIndex: '401', left: '300px', top: '180px' });
});

/** A clipping ancestor with its own content box, the shape a chat transcript has. */
function clippedSurface(options: { width: number; height: number; clipWidth: number; clipHeight: number }) {
  const viewport = document.createElement('div');
  viewport.style.overflowX = 'hidden';
  viewport.style.overflowY = 'hidden';
  Object.defineProperties(viewport, {
    clientWidth: { value: options.clipWidth }, clientHeight: { value: options.clipHeight },
    clientTop: { value: 0 }, clientLeft: { value: 0 },
    getBoundingClientRect: { value: () => new DOMRect(0, 0, options.clipWidth, options.clipHeight) },
  });
  const scroll = document.createElement('div');
  viewport.append(scroll);
  Object.defineProperties(scroll, {
    clientWidth: { value: options.width }, clientHeight: { value: options.height },
    scrollWidth: { value: options.width * 3 }, scrollHeight: { value: options.height * 3 },
    getClientRects: { value: () => [new DOMRect(0, 0, options.width, options.height)] },
    getBoundingClientRect: { value: () => new DOMRect(0, 0, options.width, options.height) },
  });
  return scroll;
}

it('clips a floating horizontal track against the viewport edge that hides its bottom', () => {
  const scroll = clippedSurface({ width: 300, height: 300, clipWidth: 300, clipHeight: 294 });
  render(<OverlayScrollbar horizontal floating scrollRef={{ current: scroll }} controlsId="code" label="Scroll code" />);
  expect(screen.getByRole('scrollbar')).toHaveStyle({ clipPath: 'inset(0px 0px 6px 0px)' });
});

it('drops a floating horizontal track once the clipping viewport hides its whole band', () => {
  const scroll = clippedSurface({ width: 300, height: 300, clipWidth: 300, clipHeight: 280 });
  render(<OverlayScrollbar horizontal floating scrollRef={{ current: scroll }} controlsId="code" label="Scroll code" />);
  expect(screen.queryByRole('scrollbar')).toBeNull();
});

it('clips a floating vertical track against the same viewport edge', () => {
  const scroll = clippedSurface({ width: 300, height: 300, clipWidth: 294, clipHeight: 300 });
  render(<OverlayScrollbar floating scrollRef={{ current: scroll }} controlsId="panel" label="Scroll panel" />);
  expect(screen.getByRole('scrollbar')).toHaveStyle({ clipPath: 'inset(0px 6px 0px 0px)' });
});

it('maps a hosted track into the owning layer so transformed popups stay aligned', () => {
  const host = document.createElement('div');
  host.style.position = 'fixed'; host.style.zIndex = '10000';
  Object.defineProperties(host, {
    clientTop: { value: 2 }, clientLeft: { value: 2 },
    offsetWidth: { value: 600 }, offsetHeight: { value: 500 },
    scrollLeft: { value: 20 }, scrollTop: { value: 40 },
    getBoundingClientRect: { value: () => new DOMRect(100, 50, 600, 500) },
  });
  const scroll = document.createElement('div'); host.append(scroll);
  Object.defineProperties(scroll, {
    clientWidth: { value: 300 }, clientHeight: { value: 200 }, scrollHeight: { value: 1000 },
    getClientRects: { value: () => [new DOMRect(120, 80, 300, 200)] },
    getBoundingClientRect: { value: () => new DOMRect(120, 80, 300, 200) },
  });
  render(<OverlayScrollbar floating layerHost={host} scrollRef={{ current: scroll }} controlsId="panel" label="Scroll panel" />);
  expect(screen.getByRole('scrollbar')).toHaveStyle({ position: 'absolute', zIndex: '1', left: '328px', top: '68px' });
});
