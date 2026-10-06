import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeClipboardText } from '@platform/clipboard';
import ErrorDetails from '../ErrorDetails';

vi.mock('@platform/clipboard', () => ({
  writeClipboardText: vi.fn().mockResolvedValue(undefined),
}));

const writeClipboardTextMock = vi.mocked(writeClipboardText);

describe('ErrorDetails', () => {
  beforeEach(() => {
    writeClipboardTextMock.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts collapsed and toggles through the chevron button', () => {
    render(<ErrorDetails title="完整错误堆栈" text="Error: boom" />);

    const toggle = screen.getByRole('button', { name: '完整错误堆栈' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(document.querySelectorAll('pre[data-selectable]')).toHaveLength(0);

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(document.querySelectorAll('pre[data-selectable]')).toHaveLength(1);

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(document.querySelectorAll('pre[data-selectable]')).toHaveLength(0);
  });

  it('renders the text selectable when open by default', () => {
    render(<ErrorDetails title="组件堆栈" text="at Crash" defaultOpen />);

    const pre = document.querySelector('pre[data-selectable]');
    expect(pre).not.toBeNull();
    expect(pre!.textContent).toBe('at Crash');
    expect(screen.getByRole('button', { name: '组件堆栈' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('copies the raw text and shows the copied state', async () => {
    render(<ErrorDetails title="组件堆栈" text="at Crash" copyTestId="details-copy" />);

    const copyButton = screen.getByTestId('details-copy');
    expect(copyButton).toHaveAttribute('data-tip', '复制组件堆栈');

    fireEvent.click(copyButton);

    await waitFor(() => expect(writeClipboardTextMock).toHaveBeenCalledWith('at Crash'));
    expect(copyButton).toHaveAttribute('data-tip', '已复制');
  });

  it('restarts the confirmation window when copied again', async () => {
    vi.useFakeTimers();
    try {
      render(<ErrorDetails title="组件堆栈" text="at Crash" copyTestId="details-copy" />);
      const copyButton = screen.getByTestId('details-copy');

      fireEvent.click(copyButton);
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(copyButton).toHaveAttribute('data-tip', '已复制');

      // Second click at t=800ms: the first timer would clear the check at
      // t=1500ms, so the restart has to keep it alive past that point.
      await act(async () => { await vi.advanceTimersByTimeAsync(800); });
      fireEvent.click(copyButton);
      await act(async () => { await vi.advanceTimersByTimeAsync(800); });
      expect(copyButton).toHaveAttribute('data-tip', '已复制');

      await act(async () => { await vi.advanceTimersByTimeAsync(800); });
      expect(copyButton).toHaveAttribute('data-tip', '复制组件堆栈');
    } finally {
      vi.useRealTimers();
    }
  });

  it('stays idle when the clipboard write fails', async () => {
    writeClipboardTextMock.mockRejectedValueOnce(new Error('permission denied'));
    render(<ErrorDetails title="组件堆栈" text="at Crash" copyTestId="details-copy" />);

    const copyButton = screen.getByTestId('details-copy');
    fireEvent.click(copyButton);

    await waitFor(() => expect(writeClipboardTextMock).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(copyButton).toHaveAttribute('data-tip', '复制组件堆栈');
  });
});
