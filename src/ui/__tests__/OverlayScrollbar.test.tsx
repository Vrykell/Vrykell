import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import OverlayScrollbar from '../OverlayScrollbar';

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
