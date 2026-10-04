import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAutoSave } from '../hooks/useAutoSave';

describe('useAutoSave', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('normalizes a saved draft without overwriting edits made during the write', async () => {
    let finish: () => void = () => {};
    const save = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const { result } = renderHook(() => useAutoSave<string>('old', save, undefined, undefined, value => value.trim()));
    act(() => result.current.setValue(' first ', true));
    await act(async () => {});
    act(() => result.current.setValue(' latest '));
    await act(async () => finish());
    expect(result.current.value).toBe(' latest ');
    await act(() => vi.advanceTimersByTimeAsync(600));
    expect(save.mock.calls).toEqual([['first'], ['latest']]);
    expect(result.current.value).toBe('latest');
  });

  it('debounces edits, exposes save status and does not save initial values', async () => {
    const save = vi.fn();
    const { result } = renderHook(() => useAutoSave<string>('initial', save));
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(save).not.toHaveBeenCalled();
    act(() => result.current.setValue('a'));
    await act(() => vi.advanceTimersByTimeAsync(400));
    act(() => result.current.setValue('ab'));
    expect(result.current.status).toBe('pending');
    await act(() => vi.advanceTimersByTimeAsync(599));
    expect(save).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(save).toHaveBeenCalledExactlyOnceWith('ab');
    expect(result.current.status).toBe('saved');
  });

  it('serializes edits arriving during an in-flight save and keeps the latest draft', async () => {
    let finish: () => void = () => {};
    const save = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const { result, rerender } = renderHook(({ value }) => useAutoSave(value, save), { initialProps: { value: 'initial' } });
    act(() => result.current.setValue('first', true));
    await act(async () => {});
    expect(result.current.status).toBe('saving');
    act(() => result.current.setValue('latest'));
    rerender({ value: 'first' });
    expect(result.current.value).toBe('latest');
    await act(() => vi.advanceTimersByTimeAsync(600));
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    expect(save.mock.calls).toEqual([['first'], ['latest']]);
    expect(result.current.status).toBe('saved');
  });

  it('retains failed drafts, reports errors and supports retry', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('failure')).mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutoSave<string>('old', save));
    act(() => result.current.setValue('new'));
    await act(() => vi.advanceTimersByTimeAsync(600));
    expect(result.current.status).toBe('error');
    expect(result.current.value).toBe('new');
    await act(() => result.current.flush());
    expect(save).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe('saved');
  });

  it('flushes pending edits on unmount and can cancel before deletion', async () => {
    const save = vi.fn();
    const first = renderHook(() => useAutoSave<string>('old', save));
    act(() => first.result.current.setValue('new'));
    first.unmount();
    await act(async () => {});
    expect(save).toHaveBeenCalledExactlyOnceWith('new');
    const second = renderHook(() => useAutoSave<string>('old', save));
    act(() => { second.result.current.setValue('deleted'); second.result.current.cancel(); });
    second.unmount();
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('blocks invalid drafts and saves a valid correction', async () => {
    const save = vi.fn();
    const { result } = renderHook(() => useAutoSave<string>('old', save, value => value.trim() ? undefined : '请填写名称'));
    act(() => result.current.setValue(''));
    await act(() => vi.advanceTimersByTimeAsync(600));
    expect(save).not.toHaveBeenCalled();
    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('请填写名称');
    act(() => result.current.setValue('valid'));
    await act(() => vi.advanceTimersByTimeAsync(600));
    expect(save).toHaveBeenCalledExactlyOnceWith('valid');
  });

  it('returns to idle when an in-flight save finishes after cancellation', async () => {
    let finish: () => void = () => {};
    const save = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const { result } = renderHook(() => useAutoSave<string>('old', save));
    act(() => result.current.setValue('new', true));
    await act(async () => {});
    act(() => { void result.current.cancel(); });
    await act(async () => finish());
    expect(result.current.status).toBe('idle');
    expect(result.current.hasPending()).toBe(false);
  });
});
