import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '@i18n';
import { writeClipboardText } from '@platform/clipboard';
import CopyButton from '../CopyButton';

vi.mock('@platform/clipboard', () => ({
  writeClipboardText: vi.fn().mockResolvedValue(undefined),
}));

const writeClipboardTextMock = vi.mocked(writeClipboardText);

describe('CopyButton', () => {
  it('keeps the row surface transparent when quiet hover feedback is requested', () => {
    render(<CopyButton quiet text="npm run build" label="Copy command" />);
    const button = screen.getByRole('button', { name: 'Copy command' });
    fireEvent.mouseEnter(button);
    expect(button).toHaveStyle({ background: 'transparent' });
    fireEvent.mouseLeave(button);
    expect(button).toHaveStyle({ background: 'transparent' });
  });
  beforeEach(() => {
    writeClipboardTextMock.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('copies the text and confirms through the accessible name', async () => {
    render(<CopyButton text="npm run build" label={t('Copy output')} testId="copy" />);
    const button = screen.getByTestId('copy');
    expect(button).toHaveAttribute('data-tip', '复制输出');
    expect(button).toHaveAttribute('aria-label', '复制输出');
    expect(button).toHaveAttribute('data-copied', 'false');

    fireEvent.click(button);

    await waitFor(() => expect(writeClipboardTextMock).toHaveBeenCalledWith('npm run build'));
    expect(button).toHaveAttribute('data-tip', '已复制');
    expect(button).toHaveAttribute('data-copied', 'true');
  });

  it('restarts the confirmation window when copied again', async () => {
    vi.useFakeTimers();
    try {
      render(<CopyButton text="at Crash" label={t('Copy output')} testId="copy" />);
      const button = screen.getByTestId('copy');

      fireEvent.click(button);
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(button).toHaveAttribute('data-copied', 'true');

      // Second click at t=800ms: the first timer would clear the check at
      // t=1500ms, so the restart has to keep it alive past that point.
      await act(async () => { await vi.advanceTimersByTimeAsync(800); });
      fireEvent.click(button);
      await act(async () => { await vi.advanceTimersByTimeAsync(800); });
      expect(button).toHaveAttribute('data-copied', 'true');

      await act(async () => { await vi.advanceTimersByTimeAsync(800); });
      expect(button).toHaveAttribute('data-copied', 'false');
    } finally {
      vi.useRealTimers();
    }
  });

  it('stays idle when the clipboard write fails', async () => {
    writeClipboardTextMock.mockRejectedValueOnce(new Error('permission denied'));
    render(<CopyButton text="at Crash" label={t('Copy output')} testId="copy" />);
    const button = screen.getByTestId('copy');

    fireEvent.click(button);

    await waitFor(() => expect(writeClipboardTextMock).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(button).toHaveAttribute('data-copied', 'false');
    expect(button).toHaveAttribute('data-tip', '复制输出');
  });
});
