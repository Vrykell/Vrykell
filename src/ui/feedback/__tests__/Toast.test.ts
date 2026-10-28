import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useToastStore } from '@ui/feedback/Toast';

describe('toast store', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [], timers: {} });
    vi.useFakeTimers();
  });
  afterEach(() => { vi.useRealTimers(); });

  it('adds and auto-removes toast after duration (leaving → remove)', () => {
    useToastStore.getState().addToast('测试消息');
    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(useToastStore.getState().toasts[0]!.message).toBe('测试消息');
    expect(useToastStore.getState().toasts[0]!.type).toBe('info');

    // After 3s mark it as leaving (still in the list while the animation plays)
    vi.advanceTimersByTime(3000);
    expect(useToastStore.getState().toasts[0]!.leaving).toBe(true);
    // Once the animation ends (+200ms) remove it for real
    vi.advanceTimersByTime(200);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('supports all types', () => {
    useToastStore.getState().addToast('成功', 'success');
    useToastStore.getState().addToast('失败', 'error');
    useToastStore.getState().addToast('注意', 'warning');
    const toasts = useToastStore.getState().toasts;
    expect(toasts.map((t) => t.type)).toEqual(['success', 'error', 'warning']);
  });

  it('does not auto-dismiss when duration=0', () => {
    useToastStore.getState().addToast('常驻', 'info', 0);
    vi.advanceTimersByTime(10000);
    expect(useToastStore.getState().toasts).toHaveLength(1);
    // Manual close
    useToastStore.getState().removeToast(useToastStore.getState().toasts[0]!.id);
    expect(useToastStore.getState().toasts[0]!.leaving).toBe(true);
    vi.advanceTimersByTime(200);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('pause stops auto-dismiss on hover and resume restarts the timer', () => {
    useToastStore.getState().addToast('暂停', 'info');
    const id = useToastStore.getState().toasts[0]!.id;
    useToastStore.getState().pause(id);
    vi.advanceTimersByTime(10000);
    // The toast stays while paused
    expect(useToastStore.getState().toasts).toHaveLength(1);
    // resume restarts the timer
    useToastStore.getState().resume(id);
    vi.advanceTimersByTime(3000);
    expect(useToastStore.getState().toasts[0]!.leaving).toBe(true);
    vi.advanceTimersByTime(200);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('assigns unique IDs', () => {
    useToastStore.getState().addToast('a');
    useToastStore.getState().addToast('b');
    const ids = useToastStore.getState().toasts.map((t) => t.id);
    expect(ids[0]).not.toBe(ids[1]);
  });
});
