import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useFollowBottom, registerFollowEngager, engageFollow } from '@features/terminal/hooks/useFollowBottom';

function makeEl(scrollTop: number) {
  const el = document.createElement('div');
  Object.defineProperties(el, {
    scrollHeight: { value: 1000, configurable: true },
    clientHeight: { value: 200, configurable: true },
    scrollTop: { value: scrollTop, writable: true, configurable: true },
  });
  return el;
}

describe('useFollowBottom', () => {
  it('leaves live-terminal wheel events to the embedded terminal', async () => {
    const el = makeEl(800);
    const running = document.createElement('div');
    running.dataset.testid = 'running-term';
    el.appendChild(running);
    const innerWheel = vi.fn();
    running.addEventListener('wheel', innerWheel);
    const { rerender } = renderHook(({ dep }) => useFollowBottom({ current: el }, [dep]), { initialProps: { dep: 1 } });
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    el.scrollTop = 700;
    const wheel = new WheelEvent('wheel', { deltaY: -350, bubbles: true, cancelable: true });
    running.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(false);
    expect(innerWheel).toHaveBeenCalledTimes(1);
    expect(el.scrollTop).toBe(700);
    rerender({ dep: 2 });
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    expect(el.scrollTop).toBe(1000);
  });
  it('keeps following when a bottom jump is followed by a resize before its scroll event', async () => {
    let notify: ResizeObserverCallback = () => {};
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) { notify = callback; }
      observe() {}
      disconnect() {}
    });
    try {
      const el = makeEl(800);
      const ref = { current: el } as React.RefObject<HTMLDivElement>;
      renderHook(() => useFollowBottom(ref, []));
      el.scrollTop = 300;
      el.dispatchEvent(new Event('scroll'));
      el.scrollTop = 800;
      Object.defineProperty(el, 'clientHeight', { value: 180, configurable: true });
      notify([], {} as ResizeObserver);
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      expect(el.scrollTop).toBe(1000);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('observes the complete output wrapper and follows live height changes', async () => {
    let notify: ResizeObserverCallback = () => {};
    const observe = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) { notify = callback; }
      observe = observe;
      disconnect() {}
    });
    try {
      const el = makeEl(800);
      const wrapper = document.createElement('div');
      wrapper.appendChild(document.createElement('button'));
      el.appendChild(wrapper);
      const ref = { current: el } as React.RefObject<HTMLDivElement>;
      renderHook(() => useFollowBottom(ref, []));
      expect(observe).toHaveBeenCalledWith(el);
      expect(observe).toHaveBeenCalledWith(wrapper);

      Object.defineProperty(el, 'scrollHeight', { value: 1400, configurable: true });
      notify([] as ResizeObserverEntry[], {} as ResizeObserver);
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      expect(el.scrollTop).toBe(1400);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('scrolls to the bottom when deps change while pinned to the bottom', async () => {
    const el = makeEl(800); // pinned to the bottom
    const ref = { current: el } as React.RefObject<HTMLDivElement>;
    const { rerender } = renderHook(({ dep }) => useFollowBottom(ref, [dep]), {
      initialProps: { dep: 1 },
    });
    rerender({ dep: 2 });
    await new Promise((r) => requestAnimationFrame(r)); // the hook scrolls inside rAF
    expect(el.scrollTop).toBe(1000);
  });

  it('stops following after the user scrolls up', async () => {
    const el = makeEl(800);
    const ref = { current: el } as React.RefObject<HTMLDivElement>;
    const { rerender } = renderHook(({ dep }) => useFollowBottom(ref, [dep]), {
      initialProps: { dep: 1 },
    });
    el.scrollTop = 300; // user scrolls up
    el.dispatchEvent(new Event('scroll'));
    rerender({ dep: 2 });
    await new Promise((r) => requestAnimationFrame(r));
    expect(el.scrollTop).toBe(300);
  });

  it('a late scroll event after a snap does not release the latch when content grows (mid-scroll race)', async () => {
    // In a real browser scrollTop=scrollHeight is clamped to max=scrollHeight-clientHeight; the
    // snap's scroll event is dispatched asynchronously, so grown content measures gap>32 and looks like a scroll up.
    const el = makeEl(800);
    const ref = { current: el } as React.RefObject<HTMLDivElement>;
    const { rerender } = renderHook(({ dep }) => useFollowBottom(ref, [dep]), {
      initialProps: { dep: 1 },
    });
    // first dep change -> snap (jsdom does not clamp, scrollTop=1000; a browser stays at the old max after clamping)
    rerender({ dep: 2 });
    await new Promise((r) => requestAnimationFrame(r));
    const snapped = el.scrollTop;
    // content grows (new output renders) and only then does the late snap scroll event dispatch
    Object.defineProperty(el, 'scrollHeight', { value: 1400, configurable: true });
    el.dispatchEvent(new Event('scroll'));
    // the latch must still be pinned: the next dep change keeps following
    rerender({ dep: 3 });
    await new Promise((r) => requestAnimationFrame(r));
    expect(el.scrollTop).toBe(1400);
    expect(snapped).toBe(1000);
  });
});

describe('registerFollowEngager / engageFollow', () => {
  it('engageFollow calls the registered callback and stops after unregistering', () => {
    const fn = vi.fn();
    const unreg = registerFollowEngager('p1', fn);
    engageFollow('p1');
    expect(fn).toHaveBeenCalledTimes(1);
    unreg();
    engageFollow('p1');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('re-registering the same id replaces the old callback with the new one', () => {
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    registerFollowEngager('p1', fn1);
    registerFollowEngager('p1', fn2);
    engageFollow('p1');
    expect(fn2).toHaveBeenCalledTimes(1);
    expect(fn1).not.toHaveBeenCalled();
  });
});

it('retains bottom-following through remounts when output grows while the pane is detached', async () => {
  const el = makeEl(800);
  const ref = { current: el };
  const first = renderHook(() => useFollowBottom(ref, [], 'remount-follow'));
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  first.unmount();
  Object.defineProperty(el, 'scrollHeight', { value: 1800, configurable: true });
  renderHook(() => useFollowBottom(ref, [], 'remount-follow'));
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  expect(el.scrollTop).toBe(1800);
});

it('retains a paused reading position through remounts and background output', async () => {
  const el = makeEl(800);
  const ref = { current: el };
  const first = renderHook(() => useFollowBottom(ref, [], 'remount-reading'));
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  el.scrollTop = 300;
  el.dispatchEvent(new Event('scroll'));
  first.unmount();
  Object.defineProperty(el, 'scrollHeight', { value: 1800, configurable: true });
  renderHook(() => useFollowBottom(ref, [], 'remount-reading'));
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  expect(el.scrollTop).toBe(300);
});

it('keeps following fractional programmatic offsets and content-clamp scroll events', async () => {
  const el = makeEl(800);
  const ref = { current: el };
  const { rerender } = renderHook(({ dep }) => useFollowBottom(ref, [dep]), { initialProps: { dep: 1 } });
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  el.scrollTop += 0.25;
  el.dispatchEvent(new Event('scroll'));
  Object.defineProperty(el, 'scrollHeight', { value: 700, configurable: true });
  el.scrollTop = 500;
  el.dispatchEvent(new Event('scroll'));
  Object.defineProperty(el, 'scrollHeight', { value: 1800, configurable: true });
  rerender({ dep: 2 });
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  expect(el.scrollTop).toBe(1800);
});

it('captures a reading anchor below the pinned title overlay', async () => {
  const scroll = makeEl(800);
  const parent = document.createElement('div');
  const title = document.createElement('div');
  title.className = 'pinned-command';
  const content = document.createElement('div');
  content.dataset.testid = 'command-block-anchor';
  scroll.appendChild(content);
  parent.append(scroll, title);
  document.body.appendChild(parent);
  const rect = (top: number, bottom: number): DOMRect => ({ top, bottom, left: 0, right: 600,
    width: 600, height: bottom - top, x: 0, y: top, toJSON: () => ({}) });
  vi.spyOn(scroll, 'getBoundingClientRect').mockReturnValue(rect(100, 300));
  vi.spyOn(title, 'getBoundingClientRect').mockReturnValue(rect(100, 160));
  const original = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');
  const point = vi.fn(() => content);
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: point });
  const { unmount } = renderHook(() => useFollowBottom({ current: scroll }, []));
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  scroll.scrollTop = 300;
  scroll.dispatchEvent(new Event('scroll'));
  expect(point).toHaveBeenLastCalledWith(80, 168);
  unmount();
  if (original) Object.defineProperty(document, 'elementFromPoint', original);
  else Reflect.deleteProperty(document, 'elementFromPoint');
  parent.remove();
});
