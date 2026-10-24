import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { writeClipboardText } from '@platform/clipboard';
import ErrorBoundary from '@ui/feedback/ErrorBoundary';

vi.mock('@platform/clipboard', () => ({
  writeClipboardText: vi.fn().mockResolvedValue(undefined),
}));

const writeClipboardTextMock = vi.mocked(writeClipboardText);

function Crash({ message }: { message: string }): ReactNode {
  throw new Error(message);
}

function renderCrash(message = 'handleRowDoubleClick is not defined') {
  return render(
    <ErrorBoundary>
      <Crash message={message} />
    </ErrorBoundary>,
  );
}

describe('ErrorBoundary fallback', () => {
  beforeEach(() => {
    writeClipboardTextMock.mockReset().mockResolvedValue(undefined);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the message and the expanded render stack', async () => {
    renderCrash();

    expect(screen.getByText('页面渲染错误')).toBeVisible();
    expect(screen.getByText('handleRowDoubleClick is not defined')).toHaveAttribute('data-selectable');
    expect(screen.getByRole('button', { name: '完整错误堆栈' })).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByRole('button', { name: '组件堆栈' })).toHaveAttribute('aria-expanded', 'false');
    expect(document.querySelectorAll('pre[data-selectable]')).toHaveLength(1);
  });

  it('toggles a stack section through its chevron button', async () => {
    renderCrash();

    const toggle = await screen.findByRole('button', { name: '组件堆栈' });
    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const expanded = document.querySelectorAll('pre[data-selectable]');
    expect(expanded).toHaveLength(2);
    expect(expanded[1].textContent).toContain('at Crash');

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(document.querySelectorAll('pre[data-selectable]')).toHaveLength(1);
  });

  it('copies the render stack from the box header', async () => {
    renderCrash();

    fireEvent.click(screen.getByTestId('error-copy-stack'));

    await waitFor(() => expect(writeClipboardTextMock).toHaveBeenCalledTimes(1));
    const copied = writeClipboardTextMock.mock.calls[0][0];
    expect(copied).toContain('Error: handleRowDoubleClick is not defined');
    expect(copied).toContain('at Crash');
    expect(copied).not.toContain('组件堆栈');
  });

  it('copies a collapsed section without expanding it', async () => {
    renderCrash();

    const copyButton = await screen.findByTestId('error-copy-component-stack');
    fireEvent.click(copyButton);

    await waitFor(() => expect(writeClipboardTextMock).toHaveBeenCalledTimes(1));
    expect(writeClipboardTextMock.mock.calls[0][0]).toContain('at Crash');
    expect(screen.getByRole('button', { name: '组件堆栈' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('switches the icon button to a copied state after a successful write', async () => {
    renderCrash();

    const copyButton = screen.getByTestId('error-copy-stack');
    expect(copyButton).toHaveAttribute('data-tip', '复制完整错误堆栈');

    fireEvent.click(copyButton);

    await waitFor(() => expect(copyButton).toHaveAttribute('data-tip', '已复制'));
  });

  it('keeps the icon button idle when the clipboard write fails', async () => {
    writeClipboardTextMock.mockRejectedValueOnce(new Error('permission denied'));
    renderCrash();

    const copyButton = screen.getByTestId('error-copy-stack');
    fireEvent.click(copyButton);

    await waitFor(() => expect(writeClipboardTextMock).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(copyButton).toHaveAttribute('data-tip', '复制完整错误堆栈');
  });
});
