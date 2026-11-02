import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useToastStore } from '@ui/feedback/Toast';

describe('toast store', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [], timers: {}, background: false });
    vi.useFakeTimers();
  });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it('adds and auto-removes toast after duration (leaving → remove)', () => {
    useToastStore.getState().addToast('测试消息');
    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(useToastStore.getState().toasts[0]!.message).toBe('测试消息');
    expect(useToastStore.getState().toasts[0]!.type).toBe('info');

    // The informational timeout includes four seconds of visible reading time.
    vi.advanceTimersByTime(4000);
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

  it('pause stops auto-dismiss on hover and resume continues the remaining time', () => {
    useToastStore.getState().addToast('暂停', 'info');
    const id = useToastStore.getState().toasts[0]!.id;
    useToastStore.getState().pause(id);
    vi.advanceTimersByTime(10000);
    // The toast stays while paused
    expect(useToastStore.getState().toasts).toHaveLength(1);
    // An immediate pause retains the complete reading time.
    useToastStore.getState().resume(id);
    vi.advanceTimersByTime(4000);
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

  it('uses semantic timeouts and gives longer messages bounded reading time', () => {
    for (const type of ['success', 'info', 'warning', 'error'] as const) useToastStore.getState().addToast('Message', type);
    useToastStore.getState().addToast('Long message '.repeat(50));
    expect(useToastStore.getState().toasts.map(item => item.duration)).toEqual([3000, 4000, 6000, 8000, 12000]);
  });

  it('retains elapsed reading time across overlapping pointer and keyboard pauses', () => {
    useToastStore.getState().addToast('Message', 'info', 1000);
    const id = useToastStore.getState().toasts[0]!.id;
    vi.advanceTimersByTime(250);
    useToastStore.getState().pause(id);
    useToastStore.getState().pause(id, 'focus');
    vi.advanceTimersByTime(5000);
    useToastStore.getState().resume(id);
    vi.advanceTimersByTime(5000);
    expect(useToastStore.getState().toasts[0]!.leaving).toBeUndefined();
    useToastStore.getState().resume(id, 'focus');
    useToastStore.getState().resume(id, 'focus');
    expect(Object.keys(useToastStore.getState().timers)).toHaveLength(1);
    vi.advanceTimersByTime(749);
    expect(useToastStore.getState().toasts[0]!.leaving).toBeUndefined();
    vi.advanceTimersByTime(251);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('preserves existing and newly added notifications while the window is in the background', () => {
    useToastStore.getState().addToast('First', 'info', 1000);
    vi.advanceTimersByTime(250);
    useToastStore.getState().setBackground(true);
    useToastStore.getState().addToast('Second', 'info', 1000);
    vi.advanceTimersByTime(20000);
    expect(useToastStore.getState().toasts).toHaveLength(2);
    useToastStore.getState().setBackground(false);
    vi.advanceTimersByTime(950);
    expect(useToastStore.getState().toasts.map(item => item.message)).toEqual(['Second']);
    vi.advanceTimersByTime(250);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});
