import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useToastStore } from '../Toast';

describe('toast store', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
    vi.useFakeTimers();
  });

  it('adds and auto-removes toast after 3s', () => {
    useToastStore.getState().addToast('测试消息');
    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(useToastStore.getState().toasts[0]!.message).toBe('测试消息');
    expect(useToastStore.getState().toasts[0]!.type).toBe('info');

    vi.advanceTimersByTime(3000);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('supports success and error types', () => {
    useToastStore.getState().addToast('成功', 'success');
    useToastStore.getState().addToast('失败', 'error');
    const toasts = useToastStore.getState().toasts;
    expect(toasts[0]!.type).toBe('success');
    expect(toasts[1]!.type).toBe('error');
  });

  it('assigns unique IDs', () => {
    useToastStore.getState().addToast('a');
    useToastStore.getState().addToast('b');
    const ids = useToastStore.getState().toasts.map((t) => t.id);
    expect(ids[0]).not.toBe(ids[1]);
  });
});
