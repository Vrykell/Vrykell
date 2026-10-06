import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { writeClipboardText } from '@platform/clipboard';
import ErrorBoundary from '../ErrorBoundary';

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

  it('keeps the crash message and both stacks selectable', async () => {
    const { container } = renderCrash();

    expect(screen.getByText('页面渲染错误')).toBeVisible();
    expect(screen.getByText('handleRowDoubleClick is not defined')).toBeVisible();
    expect(screen.getByText('完整错误堆栈')).toBeVisible();
    expect(await screen.findByText('组件堆栈')).toBeVisible();
    expect(container.querySelectorAll('[data-selectable]')).toHaveLength(3);
  });

  it('copies the message, render stack and component stack', async () => {
    renderCrash();
    await screen.findByText('组件堆栈');
    fireEvent.click(screen.getByTestId('error-copy-btn'));

    await waitFor(() => expect(writeClipboardTextMock).toHaveBeenCalledTimes(1));
    const report = writeClipboardTextMock.mock.calls[0][0];
    expect(report).toContain('Error: handleRowDoubleClick is not defined');
    expect(report).toContain('完整错误堆栈:');
    expect(report).toContain('组件堆栈:');
    expect(report.indexOf('组件堆栈:')).toBeGreaterThan(report.indexOf('完整错误堆栈:'));
  });

  it('confirms the copy after a successful write', async () => {
    renderCrash();
    fireEvent.click(screen.getByTestId('error-copy-btn'));

    expect(await screen.findByText('已复制')).toBeVisible();
  });

  it('stays silent when the clipboard write fails', async () => {
    writeClipboardTextMock.mockRejectedValueOnce(new Error('permission denied'));
    renderCrash();
    fireEvent.click(screen.getByTestId('error-copy-btn'));

    await waitFor(() => expect(writeClipboardTextMock).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(screen.queryByText('已复制')).toBeNull();
  });
});
