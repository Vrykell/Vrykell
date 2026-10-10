import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import OverlayScrollbars from '../OverlayScrollbars';

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
  await waitFor(() => expect(document.querySelector('[data-scroll-overlay-layer]')).toBeInTheDocument());
  expect(region).not.toHaveClass('overlay-scroll-target');
});
