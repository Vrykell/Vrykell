import { renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useActiveTabVisibility } from '../hooks/useActiveTabVisibility';
import { useListReorder } from '../listReorder';

afterEach(() => { vi.unstubAllGlobals(); useListReorder.getState().end(); });

it('reveals the whole selected tab on resize and leaves active drags and hidden strips alone', () => {
  let resized = () => {};
  const disconnect = vi.fn();
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resized = callback; } observe() {} disconnect = disconnect; });
  const strip = document.createElement('div'); const tab = document.createElement('div');
  tab.dataset.active = 'true'; tab.scrollIntoView = vi.fn(); strip.appendChild(tab);
  let width = 300; Object.defineProperty(strip, 'clientWidth', { get: () => width });
  const view = renderHook(() => useActiveTabVisibility({ current: strip }, '[data-active="true"]', 'selected'));
  expect(tab.scrollIntoView).toHaveBeenCalledOnce(); resized();
  expect(tab.scrollIntoView).toHaveBeenCalledTimes(2);
  useListReorder.getState().start({ listId: 'documents', id: 'selected', kind: 'document' }, { x: 10, y: 10 });
  resized(); expect(tab.scrollIntoView).toHaveBeenCalledTimes(2);
  useListReorder.getState().end(); width = 0;
  resized(); expect(tab.scrollIntoView).toHaveBeenCalledTimes(2);
  view.unmount(); expect(disconnect).toHaveBeenCalledOnce();
});
