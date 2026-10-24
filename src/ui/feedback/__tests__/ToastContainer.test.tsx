import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ToastContainer, { useToastStore } from '@ui/feedback/Toast';

describe('notification surface', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useToastStore.setState({ toasts: [], timers: {} });
  });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it('keeps the notification accessible and dismissible after its appearance changes', () => {
    useToastStore.getState().addToast('终端尚未连接', 'error', 0);
    render(<ToastContainer />);
    expect(screen.getByRole('status').textContent).toContain('终端尚未连接');
    fireEvent.click(screen.getByRole('button', { name: '关闭通知' }));
    act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('pauses while hovered and resumes without losing its text', () => {
    useToastStore.getState().addToast('连接失败', 'error', 1000);
    render(<ToastContainer />);
    fireEvent.mouseEnter(screen.getByRole('status'));
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByRole('status').textContent).toContain('连接失败');
    fireEvent.mouseLeave(screen.getByRole('status'));
    act(() => vi.advanceTimersByTime(1200));
    expect(screen.queryByRole('status')).toBeNull();
  });
});
