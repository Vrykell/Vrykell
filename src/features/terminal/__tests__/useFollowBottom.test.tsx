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
  it('routes embedded-terminal wheel events to history and pauses live following', async () => {
    const el = makeEl(800);
    const running = document.createElement('div');
    running.dataset.testid = 'running-term';
    el.appendChild(running);
    const innerWheel = vi.fn();
    running.addEventListener('wheel', innerWheel);
    const { rerender } = renderHook(({ dep }) => useFollowBottom({ current: el }, [dep]), { initialProps: { dep: 1 } });
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const wheel = new WheelEvent('wheel', { deltaY: -350, bubbles: true, cancelable: true });
    running.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(true);
    expect(innerWheel).not.toHaveBeenCalled();
    expect(el.scrollTop).toBe(650);
    Object.defineProperty(el, 'scrollHeight', { value: 1500, configurable: true });
    rerender({ dep: 2 });
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    expect(el.scrollTop).toBe(650);
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

  it('贴底时 deps 变化自动滚到底', async () => {
    const el = makeEl(800); // 贴底
    const ref = { current: el } as React.RefObject<HTMLDivElement>;
    const { rerender } = renderHook(({ dep }) => useFollowBottom(ref, [dep]), {
      initialProps: { dep: 1 },
    });
    rerender({ dep: 2 });
    await new Promise((r) => requestAnimationFrame(r)); // hook 内用 rAF 滚动
    expect(el.scrollTop).toBe(1000);
  });

  it('用户上滚后不跟随', async () => {
    const el = makeEl(800);
    const ref = { current: el } as React.RefObject<HTMLDivElement>;
    const { rerender } = renderHook(({ dep }) => useFollowBottom(ref, [dep]), {
      initialProps: { dep: 1 },
    });
    el.scrollTop = 300; // 用户上滚
    el.dispatchEvent(new Event('scroll'));
    rerender({ dep: 2 });
    await new Promise((r) => requestAnimationFrame(r));
    expect(el.scrollTop).toBe(300);
  });

  it('snap 后内容增长的迟到 scroll 事件不误杀 latch（滚到一半的竞态）', async () => {
    // 真实浏览器里 scrollTop=scrollHeight 会被 clamp 到 max=scrollHeight-clientHeight；
    // snap 的 scroll 事件异步派发，若内容已增长，旧公式量出 gap>32 会误判用户上滚。
    const el = makeEl(800);
    const ref = { current: el } as React.RefObject<HTMLDivElement>;
    const { rerender } = renderHook(({ dep }) => useFollowBottom(ref, [dep]), {
      initialProps: { dep: 1 },
    });
    // 第一次 dep 变化 → snap（jsdom 不 clamp，scrollTop=1000，模拟浏览器 clamp 后停在旧 max）
    rerender({ dep: 2 });
    await new Promise((r) => requestAnimationFrame(r));
    const snapped = el.scrollTop;
    // 内容增长（新输出渲染），随后 snap 的迟到 scroll 事件才派发
    Object.defineProperty(el, 'scrollHeight', { value: 1400, configurable: true });
    el.dispatchEvent(new Event('scroll'));
    // latch 应仍为贴底：下一次 dep 变化继续跟随
    rerender({ dep: 3 });
    await new Promise((r) => requestAnimationFrame(r));
    expect(el.scrollTop).toBe(1400);
    expect(snapped).toBe(1000);
  });
});

describe('registerFollowEngager / engageFollow', () => {
  it('注册后 engageFollow 调用对应回调，反注册后不再调用', () => {
    const fn = vi.fn();
    const unreg = registerFollowEngager('p1', fn);
    engageFollow('p1');
    expect(fn).toHaveBeenCalledTimes(1);
    unreg();
    engageFollow('p1');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('同 id 重新注册时用新回调覆盖旧的', () => {
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
