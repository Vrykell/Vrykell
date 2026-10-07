import { createRef } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTerminalStore } from '../stores/terminal';
import { ptyWrite } from '@platform/pty';
import TerminalPanel from '../components/TerminalPanel';

const { closeSession, reconnect, sessionView } = vi.hoisted(() => ({ closeSession: vi.fn(), reconnect: vi.fn(), sessionView: { status: 'ready', frame: { html: 'Password:', plainText: 'Password:', cols: 80, rows: 24 } } }));
vi.mock('../hooks/useTerminalSession', () => ({ useTerminalSession: () => ({ ref: createRef<HTMLDivElement>(), closeSession, reconnect, status: sessionView.status, frame: sessionView.frame }) }));
vi.mock('@platform/pty', () => ({ ptyWrite: vi.fn().mockResolvedValue(undefined) }));
afterEach(cleanup);
beforeEach(() => {
  vi.mocked(ptyWrite).mockClear();
  closeSession.mockReset().mockResolvedValue(undefined);
  reconnect.mockReset().mockResolvedValue(undefined);
  sessionView.status = 'ready';
  sessionView.frame.plainText = 'Password:';
  sessionView.frame.html = 'Password:';
  useTerminalStore.setState({ sessions: {}, scenes: { p: 'classic' } });
});

/** 输入方式是显式单选：点开下拉再选，而不是点一个会翻转文字的按钮。 */
function chooseInputMode(mode: '密码输入' | '直接输入') {
  fireEvent.click(screen.getByRole('combobox', { name: '输入方式' }));
  fireEvent.click(screen.getByRole('option', { name: mode }));
}

describe('SSH connection input', () => {
  it('keeps the live screen visible when manually opening masked input without an authentication prompt', () => {
    sessionView.frame.plainText = '';
    sessionView.frame.html = '';
    useTerminalStore.setState({ sessions: { p: 'session' } });
    render(<TerminalPanel paneId="p" tabId="t" onReady={() => {}} connectionInput />);
    chooseInputMode('密码输入');
    expect(screen.getByLabelText('SSH 认证响应')).toHaveAttribute('type', 'password');
    expect(screen.getByTestId('ssh-terminal-screen').tagName).toBe('DIV');
    expect(screen.getByTestId('ssh-terminal-screen')).toHaveStyle({ visibility: 'visible' });
    expect(screen.queryByText('正在连接远端主机…')).not.toBeInTheDocument();
  });
  it('reports a manual interactive disconnect without calling it authentication cancellation', async () => {
    sessionView.frame.plainText = '交互程序';
    sessionView.frame.html = '交互程序';
    useTerminalStore.setState({ sessions: { p: 'session' } });
    render(<TerminalPanel paneId="p" tabId="t" onReady={() => {}} connectionInput />);
    fireEvent.click(screen.getByRole('button', { name: '断开连接' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('已断开 SSH 连接'));
    expect(screen.getByRole('status')).not.toHaveTextContent('已取消认证');
  });
  it('disables authentication until the PTY is ready', () => {
    render(<TerminalPanel paneId="p" tabId="t" onReady={() => {}} connectionInput />);
    expect(screen.getByLabelText('SSH 认证响应')).toBeDisabled();
  });
  it('shows the xterm renderer for interactive output without synthesizing a cursor overlay', () => {
    useTerminalStore.setState({ sessions: { p: 'session' } });
    sessionView.frame.plainText = '正在等待输入';
    sessionView.frame.html = '正在等待输入';
    render(<TerminalPanel paneId="p" tabId="t" onReady={() => {}} connectionInput />);
    const xtermHost = screen.getByTestId('ssh-terminal-screen');
    expect(xtermHost).toHaveStyle({ visibility: 'visible', pointerEvents: 'auto' });
    expect(screen.queryByTestId('ssh-screen-cursor')).not.toBeInTheDocument();
  });
  it('uses the snapshot while a secret response is requested and keeps xterm out of view', () => {
    useTerminalStore.setState({ sessions: { p: 'session' } });
    render(<TerminalPanel paneId="p" tabId="t" onReady={() => {}} connectionInput />);
    expect(screen.getByTestId('ssh-terminal-screen').tagName).toBe('PRE');
    expect(screen.getByLabelText('SSH 认证响应')).toBeVisible();
    expect(screen.queryByTestId('ssh-screen-cursor')).not.toBeInTheDocument();
  });
  it('masks and clears the response after sending it to the connected PTY', () => {
    useTerminalStore.setState({ sessions: { p: 'session' } });
    render(<TerminalPanel paneId="p" tabId="t" onReady={() => {}} connectionInput />);
    const input = screen.getByLabelText('SSH 认证响应');
    expect(input).toHaveAttribute('type', 'password');
    fireEvent.change(input, { target: { value: 'response' } });
    fireEvent.submit(input.closest('form')!);
    expect(ptyWrite).toHaveBeenCalledWith('session', 'response\r');
    expect(input).toHaveValue('');
  });
  it('closes the connection, clears the secret and disables authentication after cancellation', async () => {
    useTerminalStore.setState({ sessions: { p: 'session' } });
    render(<TerminalPanel paneId="p" tabId="t" onReady={() => {}} connectionInput />);
    const input = screen.getByLabelText('SSH 认证响应');
    fireEvent.change(input, { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: '取消认证' }));
    expect(closeSession).toHaveBeenCalledOnce();
    expect(input).toHaveValue('');
    expect(input).toBeDisabled();
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('SSH 连接已关闭'));
    expect(ptyWrite).not.toHaveBeenCalled();
  });
  it('allows cancellation to be retried if closing the connection fails', async () => {
    closeSession.mockRejectedValueOnce(new Error('close failed'));
    useTerminalStore.setState({ sessions: { p: 'session' } });
    render(<TerminalPanel paneId="p" tabId="t" onReady={() => {}} connectionInput />);
    fireEvent.click(screen.getByRole('button', { name: '取消认证' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('取消失败'));
    expect(screen.getByLabelText('SSH 认证响应')).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '取消认证' }));
    await waitFor(() => expect(screen.getByRole('status')).toBeVisible());
    expect(closeSession).toHaveBeenCalledTimes(2);
  });
  it('ignores repeated cancellation and submit attempts while closing', async () => {
    let finish!: () => void;
    closeSession.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    useTerminalStore.setState({ sessions: { p: 'session' } });
    render(<TerminalPanel paneId="p" tabId="t" onReady={() => {}} connectionInput />);
    fireEvent.click(screen.getByRole('button', { name: '取消认证' }));
    fireEvent.click(screen.getByRole('button', { name: '正在取消…' }));
    fireEvent.submit(screen.getByLabelText('SSH 认证响应').closest('form')!);
    expect(closeSession).toHaveBeenCalledOnce();
    expect(ptyWrite).not.toHaveBeenCalled();
    finish();
    await waitFor(() => expect(screen.getByRole('status')).toBeVisible());
  });
  it('removes authentication controls when the remote shell is ready', () => {
    useTerminalStore.setState({ scenes: { p: 'blockList' } });
    render(<TerminalPanel paneId="p" tabId="t" onReady={() => {}} connectionInput />);
    expect(screen.queryByLabelText('SSH 认证响应')).toBeNull();
  });
  it('switches to raw keyboard interaction after a password response without waiting for shell markers', () => {
    useTerminalStore.setState({ sessions: { p: 'session' } });
    const { rerender } = render(<TerminalPanel paneId="p" tabId="t" onReady={() => {}} connectionInput />);
    const input = screen.getByLabelText('SSH 认证响应');
    fireEvent.change(input, { target: { value: 'temporary' } });
    fireEvent.submit(input.closest('form')!);
    sessionView.frame.plainText = '交互程序 倒计时 30s';
    sessionView.frame.html = '交互程序 倒计时 30s';
    rerender(<TerminalPanel paneId="p" tabId="t" onReady={() => {}} connectionInput />);
    expect(screen.queryByLabelText('SSH 认证响应')).toBeNull();
    expect(screen.getByRole('textbox', { name: 'SSH 交互终端' })).toBeVisible();
    expect(screen.getByTestId('ssh-terminal-screen')).toBeVisible();
    expect(screen.queryByText('交互程序 倒计时 30s')).not.toBeInTheDocument();
  });
  it('does not mistake a stale password prompt for a new challenge after the screen redraws', () => {
    useTerminalStore.setState({ sessions: { p: 'session' } });
    const { rerender } = render(<TerminalPanel paneId="p" tabId="t" onReady={() => {}} connectionInput />);
    const input = screen.getByLabelText('SSH 认证响应');
    fireEvent.change(input, { target: { value: 'temporary' } });
    fireEvent.submit(input.closest('form')!);

    sessionView.frame.plainText = '交互程序：已完成登录\n方向键选择，Enter 确认，Esc 退出\nPassword:';
    sessionView.frame.html = '交互程序：已完成登录<br>方向键选择，Enter 确认，Esc 退出<br>Password:';
    rerender(<TerminalPanel paneId="p" tabId="t" onReady={() => {}} connectionInput />);

    expect(screen.queryByLabelText('SSH 认证响应')).toBeNull();
    expect(screen.getByTestId('ssh-terminal-screen')).toHaveStyle({ visibility: 'visible' });
  });
  it('reopens secret input after a rejected password and lets the user return to direct terminal input', () => {
    useTerminalStore.setState({ sessions: { p: 'session' } });
    const { rerender } = render(<TerminalPanel paneId="p" tabId="t" onReady={() => {}} connectionInput />);
    const input = screen.getByLabelText('SSH 认证响应');
    fireEvent.change(input, { target: { value: 'wrong' } });
    fireEvent.submit(input.closest('form')!);

    sessionView.frame.plainText = 'Permission denied, please try again.\nPassword:';
    sessionView.frame.html = 'Permission denied, please try again.<br>Password:';
    rerender(<TerminalPanel paneId="p" tabId="t" onReady={() => {}} connectionInput />);
    expect(screen.getByLabelText('SSH 认证响应')).toBeVisible();

    chooseInputMode('直接输入');
    rerender(<TerminalPanel paneId="p" tabId="t" onReady={() => {}} connectionInput />);
    expect(screen.queryByLabelText('SSH 认证响应')).toBeNull();
    expect(screen.getByTestId('ssh-terminal-screen')).toHaveStyle({ visibility: 'visible' });
  });
  it('replaces the dead screen with an ended block that keeps the reason and the last output', async () => {
    sessionView.status = 'closed';
    sessionView.frame.plainText = "user@server's password:\nConnection closed by server\n[进程已退出]";
    sessionView.frame.html = "user@server's password:<br>Connection closed by server<br>[进程已退出]";
    render(<TerminalPanel paneId="p" tabId="t" onReady={() => {}} connectionInput sshTarget="user@server" />);
    expect(screen.getByRole('status')).toHaveTextContent('连接已断开');
    const ended = screen.getByTestId('ssh-connection-ended');
    expect(ended).toHaveTextContent('连接已结束');
    expect(ended).toHaveTextContent('SSH 进程已退出');
    expect(ended).toHaveTextContent('最后输出');
    expect(ended).toHaveTextContent('Connection closed by server');
    // 与文件面板的远端失败页共用 ErrorBox：原因与原始输出都在，重连动作在 actions 里
    expect(ended).toHaveAttribute('role', 'alert');
    fireEvent.click(screen.getByRole('button', { name: '重新连接' }));
    await waitFor(() => expect(reconnect).toHaveBeenCalledOnce());
  });

  it('keeps the terminal read-only while the masked input is open, including after switching back from direct input', () => {
    useTerminalStore.setState({ sessions: { p: 'session' } });
    render(<TerminalPanel paneId="p" tabId="t" onReady={() => {}} connectionInput />);
    chooseInputMode('直接输入');
    const area = screen.getByRole('textbox', { name: 'SSH 交互终端' });
    expect(area).toHaveAttribute('tabindex', '0');
    expect(screen.getByTestId('ssh-terminal-screen')).toHaveStyle({ pointerEvents: 'auto' });

    chooseInputMode('密码输入');
    expect(area).toHaveAttribute('tabindex', '-1');
    expect(area).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('ssh-terminal-screen')).toHaveStyle({ pointerEvents: 'none' });
  });

  it('shows a connecting state with its own cancel action before the PTY is ready', () => {
    sessionView.status = 'connecting';
    sessionView.frame.plainText = '';
    sessionView.frame.html = '';
    render(<TerminalPanel paneId="p" tabId="t" onReady={() => {}} connectionInput sshTarget="user@server" />);
    expect(screen.getByRole('status')).toHaveTextContent('正在连接');
    expect(screen.getByTestId('ssh-connecting')).toBeVisible();
    expect(screen.getByRole('button', { name: '取消连接' })).toBeVisible();
    expect(screen.queryByTestId('ssh-connection-ended')).toBeNull();
  });
});
