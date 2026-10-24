import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeClipboardText } from '@platform/clipboard';
import ErrorBox from '../ErrorBox';
import { useRef } from 'react';
import { useDialogKeyboard } from '../useDialogKeyboard';

vi.mock('@platform/clipboard', () => ({
  writeClipboardText: vi.fn().mockResolvedValue(undefined),
}));

const writeClipboardTextMock = vi.mocked(writeClipboardText);

describe('ErrorBox', () => {
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
