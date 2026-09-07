import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { engageFollow, registerFollowEngager, useFollowBottom } from '@/terminal/useFollowBottom';

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
