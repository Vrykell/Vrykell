import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ToastContainer, { useToastStore } from '@ui/feedback/Toast';

describe('notification surface', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    useToastStore.setState({ toasts: [], timers: {}, background: false });
  });
  afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

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

  it('retains a keyboard-focused notification after the pointer leaves and restores focus on Escape', () => {
    render(<><button>Source</button><ToastContainer /></>);
    act(() => useToastStore.getState().addToast('Keyboard notification', 'info', 1000));
    const source = screen.getByRole('button', { name: 'Source' });
    source.focus();
    fireEvent.mouseEnter(screen.getByRole('status'));
    act(() => screen.getByRole('button', { name: '关闭通知' }).focus());
    fireEvent.mouseLeave(screen.getByRole('status'));
    act(() => vi.advanceTimersByTime(10000));
    expect(screen.getByRole('status')).toBeVisible();
    fireEvent.keyDown(screen.getByRole('button', { name: '关闭通知' }), { key: 'Escape' });
    expect(source).toHaveFocus();
    act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('pauses on window blur and resumes the remaining visible time on focus', () => {
    render(<ToastContainer />);
    act(() => useToastStore.getState().addToast('Background notification', 'info', 1000));
    act(() => vi.advanceTimersByTime(300));
    fireEvent(window, new Event('blur'));
    act(() => vi.advanceTimersByTime(10000));
    expect(screen.getByRole('status')).toBeVisible();
    fireEvent(window, new Event('focus'));
    act(() => vi.advanceTimersByTime(900));
    expect(screen.queryByRole('status')).toBeNull();
  });
});
