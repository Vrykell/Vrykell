import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeClipboardText } from '@platform/clipboard';
import ErrorBox from '@ui/feedback/ErrorBox';
import { useRef } from 'react';
import { useDialogKeyboard } from '@ui/hooks/useDialogKeyboard';

vi.mock('@platform/clipboard', () => ({
  writeClipboardText: vi.fn().mockResolvedValue(undefined),
}));

const writeClipboardTextMock = vi.mocked(writeClipboardText);

describe('ErrorBox', () => {
  it('shows an explicitly placed informational notification outside the panel and expires it', () => {
    vi.useFakeTimers();
    try {
      const { container } = render(<ErrorBox tone="info" placement="notification" title="Repository unavailable" details="Read failed" actions={<button>Retry</button>} autoDismissMs={1000} />);
      expect(container.querySelector('[role="status"]')).toBeNull();
      expect(document.querySelector('#app-notifications [role="status"]')).toHaveAttribute('data-tone', 'info');
      expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible();
      expect(screen.queryByRole('alert')).toBeNull();
      act(() => vi.advanceTimersByTime(1000));
      expect(screen.queryByRole('status')).toBeNull();
    } finally { vi.useRealTimers(); }
  });
  it('pauses ordinary notification expiry while the page is hidden', () => {
    vi.useFakeTimers();
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    try {
      render(<ErrorBox title="File unavailable" autoDismissMs={1000} />);
      act(() => vi.advanceTimersByTime(400));
      hidden.mockReturnValue(true);
      fireEvent(document, new Event('visibilitychange'));
      act(() => vi.advanceTimersByTime(10000));
      expect(screen.getByRole('alert')).toBeVisible();
      hidden.mockReturnValue(false);
      fireEvent(document, new Event('visibilitychange'));
      act(() => vi.advanceTimersByTime(599));
      expect(screen.getByRole('alert')).toBeVisible();
      act(() => vi.advanceTimersByTime(1));
      expect(screen.queryByRole('alert')).toBeNull();
    } finally { hidden.mockRestore(); vi.useRealTimers(); }
  });
  it('retains remaining time while hovered or focused before automatically dismissing an ordinary error', () => {
    vi.useFakeTimers();
    try {
      const dismiss = vi.fn();
      render(<ErrorBox title="File unavailable" autoDismissMs={1000} onDismiss={dismiss} />);
      const card = screen.getByRole('alert');
      act(() => vi.advanceTimersByTime(400));
      fireEvent.mouseEnter(card);
      act(() => vi.advanceTimersByTime(5000));
      expect(card).toBeVisible();
      fireEvent.focus(card);
      fireEvent.mouseLeave(card);
      act(() => vi.advanceTimersByTime(5000));
      expect(card).toBeVisible();
      fireEvent.blur(card);
      act(() => vi.advanceTimersByTime(599));
      expect(card).toBeVisible();
      act(() => vi.advanceTimersByTime(1));
      expect(screen.queryByRole('alert')).toBeNull();
      expect(dismiss).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });
  it('keeps expanded details available until the user finishes reading', () => {
    vi.useFakeTimers();
    try {
      render(<ErrorBox title="File unavailable" details="Read failed" autoDismissMs={1000} />);
      fireEvent.click(screen.getByRole('button', { name: '技术详情' }));
      act(() => vi.advanceTimersByTime(10000));
      expect(screen.getByText('Read failed')).toBeVisible();
      fireEvent.click(screen.getByRole('button', { name: '技术详情' }));
      act(() => vi.advanceTimersByTime(1000));
      expect(screen.queryByRole('alert')).toBeNull();
    } finally { vi.useRealTimers(); }
  });
  it('keeps persistent failures until dismissed and gives a new failure its own time budget', () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(<ErrorBox title="Persistent failure" />);
      act(() => vi.advanceTimersByTime(60000));
      expect(screen.getByRole('alert')).toBeVisible();
      rerender(<ErrorBox title="First failure" autoDismissMs={1000} />);
      act(() => vi.advanceTimersByTime(900));
      rerender(<ErrorBox title="Second failure" autoDismissMs={1000} />);
      act(() => vi.advanceTimersByTime(999));
      expect(screen.getByRole('alert')).toHaveTextContent('Second failure');
      act(() => vi.advanceTimersByTime(1));
      expect(screen.queryByRole('alert')).toBeNull();
    } finally { vi.useRealTimers(); }
  });
  it('supports persistent transcript failures inline without a notification portal', () => {
    const { container } = render(<ErrorBox placement="inline" dismissible={false} title="Tool failed" details="Diagnostic output" actions={<button>Retry tool</button>} />);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(document.querySelector('#app-notifications [role="alert"]')).toBeNull();
    expect(screen.queryByRole('button', { name: '关闭错误提示' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Retry tool' })).toBeVisible();
  });
  it('includes the owning notification in modal keyboard navigation and dismisses it without closing the dialog', () => {
    const close = vi.fn();
    function Dialog() {
      const ref = useRef<HTMLDivElement>(null);
      useDialogKeyboard(ref, true, { onClose: close });
      return <div role="dialog" aria-label="Dialog" ref={ref}><button onClick={close}>Owner</button><ErrorBox title="Failed" /></div>;
    }
    render(<Dialog />);
    const dismiss = screen.getByRole('button', { name: '关闭错误提示' });
    dismiss.focus(); fireEvent.keyDown(dismiss, { key: 'Tab' });
    expect(screen.getByRole('button', { name: 'Owner' })).toHaveFocus();
    dismiss.focus(); fireEvent.keyDown(dismiss, { key: 'Escape' });
    expect(screen.queryByRole('alert')).toBeNull(); expect(close).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Owner' })).toHaveFocus();
  });
  it('stacks errors in one shared notification region outside the owning layout', () => {
    const { container, unmount } = render(<div><ErrorBox title="First" /><ErrorBox title="Second" /></div>);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(document.querySelector('#app-notifications')?.querySelectorAll('[role="alert"]')).toHaveLength(2);
    unmount();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('hides errors belonging to a background pane and restores them with their owner', async () => {
    const { rerender } = render(<div hidden><ErrorBox title="Hidden pane" /></div>);
    expect(screen.queryByRole('alert')).toBeNull();
    rerender(<div><ErrorBox title="Hidden pane" /></div>);
    await screen.findByRole('alert');
    rerender(<div hidden><ErrorBox title="Hidden pane" /></div>);
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
  beforeEach(() => {
    writeClipboardTextMock.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders title, message and actions as an alert for the error tone', () => {
    render(
      <ErrorBox title="暂时无法读取远程文件" actions={<button>重试</button>}>
        请检查网络或权限后重试。
      </ErrorBox>,
    );

    expect(screen.getByRole('alert')).toBeVisible();
    expect(screen.getByRole('alert')).toHaveClass('notification-card');
    expect(screen.getByText('暂时无法读取远程文件')).toBeVisible();
    expect(screen.getByText('请检查网络或权限后重试。')).toBeVisible();
    expect(screen.getByRole('button', { name: '重试' })).toBeVisible();
  });

  it('uses the status role for non-error tones', () => {
    render(<ErrorBox tone="info">此连接暂不能浏览文件</ErrorBox>);
    expect(screen.getByRole('status')).toBeVisible();
    expect(screen.queryByRole('alert')).toBeNull();

    render(<ErrorBox tone="success">连接成功</ErrorBox>);
    expect(screen.getAllByRole('status')).toHaveLength(2);
  });

  it('renders message and actions in one row when compact', () => {
    render(
      <ErrorBox compact tone="success" testId="test-result" actions={<button>查看</button>}>
        连接成功
      </ErrorBox>,
    );

    const box = screen.getByTestId('test-result');
    expect(box).toHaveTextContent('连接成功');
    expect(box).toHaveAttribute('role', 'status');
    expect(screen.getByRole('button', { name: '查看' })).toBeVisible();
  });

  it('keeps the raw details collapsed until the toggle is clicked', () => {
    render(
      <ErrorBox details="SFTP_UNAVAILABLE: no subsystem" detailsTitle="技术详情">
        此连接暂不能浏览文件
      </ErrorBox>,
    );

    const toggle = screen.getByRole('button', { name: '技术详情' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(toggle);
    expect(document.querySelector('pre[data-selectable]')?.textContent).toBe('SFTP_UNAVAILABLE: no subsystem');
  });

  it('copies the raw details from the shared icon button', async () => {
    render(<ErrorBox details="raw diagnostic">出错了</ErrorBox>);

    fireEvent.click(screen.getByLabelText('复制技术详情'));

    await waitFor(() => expect(writeClipboardTextMock).toHaveBeenCalledWith('raw diagnostic'));
  });
  it('dismisses an error from its heading and shows a later distinct error', () => {
    const dismiss = vi.fn();
    const { rerender } = render(<ErrorBox title="Failed" details="First failure" onDismiss={dismiss} />);
    fireEvent.click(screen.getByRole('button', { name: '关闭错误提示' }));
    expect(screen.queryByRole('alert')).toBeNull(); expect(dismiss).toHaveBeenCalledOnce();
    rerender(<ErrorBox title="Failed" details="Second failure" />);
    expect(screen.getByRole('alert')).toBeVisible();
  });
});
