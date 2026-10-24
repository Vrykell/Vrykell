import { act, renderHook, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useReloadFeedback } from '@ui/hooks/useReloadFeedback';

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });

it('shows one full rotation for immediate work and ignores repeated clicks', async () => {
  const action = vi.fn();
  const { result } = renderHook(() => useReloadFeedback(action));
  await act(async () => { await result.current.run(); await result.current.run(); });
  expect(action).toHaveBeenCalledOnce();
  expect(result.current.busy).toBe(true);
  act(() => vi.advanceTimersByTime(799));
  expect(result.current.busy).toBe(true);
  act(() => vi.advanceTimersByTime(1));
  expect(result.current.busy).toBe(false);
  await act(async () => { await result.current.run(); });
  expect(action).toHaveBeenCalledTimes(2);
});

it('keeps rotating while asynchronous work is pending', async () => {
  let finish!: () => void;
  const action = () => new Promise<void>(resolve => { finish = resolve; });
  const { result } = renderHook(() => useReloadFeedback(action));
  let running!: Promise<void>;
  act(() => { running = result.current.run(); });
  act(() => vi.advanceTimersByTime(1600));
  expect(result.current.busy).toBe(true);
  await act(async () => { finish(); await running; });
  act(() => vi.runOnlyPendingTimers());
  expect(result.current.busy).toBe(false);
});

it('clears feedback after failure and removes the timer on unmount', async () => {
  const error = new Error('reload failed');
  const { result, unmount } = renderHook(() => useReloadFeedback(() => { throw error; }));
  await act(async () => { await expect(result.current.run()).rejects.toBe(error); });
  act(() => vi.advanceTimersByTime(800));
  expect(result.current.busy).toBe(false);
  await act(async () => { await expect(result.current.run()).rejects.toBe(error); });
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});
