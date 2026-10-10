import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import OverlayScrollbars, { scrollbarLayerHost } from '../OverlayScrollbars';

beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }));
afterEach(() => { cleanup(); document.querySelectorAll('[data-test-surface]').forEach(element => element.remove()); vi.unstubAllGlobals(); });
it('discovers dynamic scroll surfaces without wrapping their content and cleans up on unmount', async () => {
  const view = render(<OverlayScrollbars />);
  const region = document.createElement('div');
  region.dataset.testSurface = '';
  region.style.overflowY = 'auto';
  const content = document.createElement('p');
  region.append(content);
  document.body.append(region);
  await waitFor(() => expect(region).toHaveClass('overlay-scroll-target'));
  expect(region.firstChild).toBe(content);
  region.style.overflowY = 'hidden';
  await waitFor(() => expect(region).not.toHaveClass('overlay-scroll-target'));
  region.style.overflowY = 'auto';
  await waitFor(() => expect(region).toHaveClass('overlay-scroll-target'));
  view.unmount();
  expect(region).not.toHaveClass('overlay-scroll-target');
});
it('preserves the terminal renderer and the existing block-history scrollbar', async () => {
  const region = document.createElement('div');
  region.dataset.testSurface = '';
  region.className = 'terminal-block-scroll';
  region.style.overflowY = 'auto';
  document.body.append(region);
  render(<OverlayScrollbars />);
  expect(region).not.toHaveClass('overlay-scroll-target');
  expect(document.querySelector('[data-scroll-overlay-layer]')).toBeNull();
});

it('keeps page tracks inside the application layer and popup tracks inside their own layer', async () => {
  const frame = document.createElement('div');
  frame.dataset.testSurface = '';
  frame.style.position = 'relative'; frame.style.zIndex = '1';
  const page = document.createElement('div'); page.style.overflowY = 'auto';
  frame.append(page); document.body.append(frame);
  const popup = document.createElement('div'); popup.dataset.testSurface = '';
  popup.style.position = 'fixed'; popup.style.zIndex = '9996';
  const menu = document.createElement('div'); menu.style.overflowY = 'auto';
  popup.append(menu); document.body.append(popup);
  const view = render(<OverlayScrollbars />);
  await waitFor(() => expect(frame.querySelector('[data-scroll-overlay-layer]')).not.toBeNull());
  expect(popup.querySelector('[data-scroll-overlay-layer]')).not.toBeNull();
  expect(scrollbarLayerHost(page)).toBe(frame);
  expect(scrollbarLayerHost(menu)).toBe(popup);
  expect(document.body.querySelector(':scope > [data-scroll-overlay-layer]')).toBeNull();
  view.unmount();
  expect(frame.querySelector('[data-scroll-overlay-layer]')).toBeNull();
});
