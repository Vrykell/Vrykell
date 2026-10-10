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
