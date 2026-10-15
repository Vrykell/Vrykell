import { createRef } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTerminalStore } from '../stores/terminal';
import { ptyWrite } from '@platform/pty';
import TerminalPanel from '../components/TerminalPanel';

const { closeSession, reconnect, stopReconnect, sessionView } = vi.hoisted(() => ({ closeSession: vi.fn(), reconnect: vi.fn(), stopReconnect: vi.fn(), sessionView: { sshAuthenticated: false, sshLog: [] as { time: number; text: string }[], retry: { phase: 'idle', attempt: 0, seconds: 0 }, status: 'ready', frame: { html: 'Password:', plainText: 'Password:', cols: 80, rows: 24 } } }));
vi.mock('../hooks/useTerminalSession', () => ({ useTerminalSession: () => ({ ref: createRef<HTMLDivElement>(), closeSession, reconnect, stopReconnect, sshAuthenticated: sessionView.sshAuthenticated, sshLog: sessionView.sshLog, retry: sessionView.retry, status: sessionView.status, frame: sessionView.frame }) }));
vi.mock('@platform/pty', () => ({ ptyWrite: vi.fn().mockResolvedValue(undefined) }));
afterEach(cleanup);
beforeEach(() => {
  vi.mocked(ptyWrite).mockClear();
  closeSession.mockReset().mockResolvedValue(undefined);
  reconnect.mockReset().mockResolvedValue(undefined);
  sessionView.status = 'ready';
  sessionView.sshAuthenticated = false;
  sessionView.retry = { phase: 'idle', attempt: 0, seconds: 0 };
  stopReconnect.mockReset().mockResolvedValue(undefined);
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
  it('opens status from the connection card and exposes a themed hover hint', () => {
    const toggle = vi.fn();
    const ready = vi.fn();
    const view = render(<TerminalPanel paneId="p" tabId="t" onReady={() => {}} connectionInput onSessionStatusClick={toggle} onSessionStatusReady={ready} />);
    const entry = screen.getByTestId('ssh-status-toggle');
    expect(entry).toContainElement(screen.getByRole('status'));
    expect(entry).toHaveAttribute('data-tip', '查看 SSH 连接状态与资源');
    expect(entry).toHaveAttribute('aria-expanded', 'false');
    expect(ready).toHaveBeenCalledWith(entry);
    fireEvent.click(entry);
    expect(toggle).toHaveBeenCalledOnce();
    view.rerender(<TerminalPanel paneId="p" tabId="t" onReady={() => {}} connectionInput onSessionStatusClick={toggle} sessionStatusOpen />);
    expect(entry).toHaveAttribute('aria-expanded', 'true');
    expect(entry).toHaveAttribute('data-tip', '关闭 SSH 状态');
  });
  it('renders one classic toolbar in the shared host and removes it in block mode', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    useTerminalStore.setState({ sessions: { p: 'session' }, scenes: { p: 'blockList' } });
    const view = render(<TerminalPanel paneId="p" tabId="t" onReady={() => {}} connectionInput toolbarHost={host} />);
    expect(screen.getAllByTestId('ssh-session-toolbar')).toHaveLength(1);
    expect(host).toContainElement(screen.getByTestId('ssh-session-toolbar'));
    expect(screen.getByTestId('ssh-session-toolbar')).toBeVisible();
    expect(screen.getByTestId('ssh-connection-input')).not.toContainElement(screen.getByTestId('ssh-session-toolbar'));
    view.rerender(<TerminalPanel paneId="p" tabId="t" onReady={() => {}} connectionInput toolbarHost={host} showToolbar={false} />);
    expect(screen.queryByTestId('ssh-session-toolbar')).not.toBeInTheDocument();
    host.remove();
  });
  it('keeps the connected phase while an authenticated shell requests a command password', () => {
    sessionView.sshAuthenticated = true;
    sessionView.frame.plainText = '[sudo] password for deploy:';
    useTerminalStore.setState({ sessions: { p: 'session' } });
    const stateChanged = vi.fn();
    render(<TerminalPanel paneId="p" tabId="t" onReady={() => {}} connectionInput onSshStateChange={stateChanged} />);
    expect(screen.getByLabelText('SSH 认证响应')).toBeVisible();
    expect(stateChanged).toHaveBeenLastCalledWith({ phase: 'connected', reconnectAttempt: 0, retrying: false, log: [] });
  });

  it('reports the initial password request as authentication before a remote prompt is confirmed', () => {
    const stateChanged = vi.fn();
    render(<TerminalPanel paneId="p" tabId="t" onReady={() => {}} connectionInput onSshStateChange={stateChanged} />);
    expect(stateChanged).toHaveBeenLastCalledWith({ phase: 'authenticating', reconnectAttempt: 0, retrying: false, log: [] });
  });
  it('shows pending retries with immediate and stop actions, and reports exhaustion', async () => {
    sessionView.status = 'closed';
    sessionView.retry = { phase: 'waiting', attempt: 2, seconds: 4 };
    const { rerender } = render(<TerminalPanel paneId="p" tabId="t" onReady={() => {}} connectionInput />);
    expect(screen.getByRole('status')).toHaveTextContent('第 2/5 次，4 秒后重试');
    fireEvent.click(screen.getByRole('button', { name: '停止重试' }));
    expect(stopReconnect).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '立即重试' }));
    await waitFor(() => expect(reconnect).toHaveBeenCalledOnce());
    sessionView.retry = { phase: 'exhausted', attempt: 5, seconds: 0 };
    rerender(<TerminalPanel paneId="p" tabId="t" onReady={() => {}} connectionInput />);
    expect(screen.getByRole('status')).toHaveTextContent('自动重连已结束（5 次）');
  });

  it('freezes the screen while masked input is open so no terminal cursor is left behind', () => {
    sessionView.frame.plainText = 'bash-5.2$ ';
    sessionView.frame.html = 'bash-5.2$ ';
    useTerminalStore.setState({ sessions: { p: 'session' } });
    render(<TerminalPanel paneId="p" tabId="t" onReady={() => {}} connectionInput />);
    chooseInputMode('密码输入');
    expect(screen.getByLabelText('SSH 认证响应')).toHaveAttribute('type', 'password');
    // 冻结成快照：live xterm 会自己画光标，看起来像还能在屏幕上输入
    expect(screen.getByTestId('ssh-terminal-screen').tagName).toBe('PRE');
    expect(screen.getByTestId('ssh-terminal-screen')).toHaveClass('ssh-terminal-frame');
    expect(screen.queryByText('正在连接远端主机…')).not.toBeInTheDocument();
  });
  it('reports a manual interactive disconnect without calling it authentication cancellation', async () => {
    sessionView.frame.plainText = '交互程序';
    sessionView.frame.html = '交互程序';
    useTerminalStore.setState({ sessions: { p: 'session' } });
    render(<TerminalPanel paneId="p" tabId="t" onReady={() => {}} connectionInput />);
    fireEvent.click(screen.getByRole('button', { name: '断开连接' }));
    await waitFor(() => expect(screen.getByText('已断开 SSH 连接')).toBeVisible());
    expect(screen.queryByText(/已取消认证/)).toBeNull();
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
  it('reveals the masked response through the themed toggle and keeps the blue submit action', () => {
    useTerminalStore.setState({ sessions: { p: 'session' } });
    render(<TerminalPanel paneId="p" tabId="t" onReady={() => {}} connectionInput />);
    const input = screen.getByLabelText('SSH 认证响应');
    expect(input).toHaveAttribute('type', 'password');
    const reveal = screen.getByTestId('ssh-auth-reveal');
    expect(reveal).toHaveAttribute('aria-label', '显示密码');
    expect(reveal).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(reveal);
    expect(reveal).toHaveAttribute('aria-label', '隐藏密码');
    expect(reveal).toHaveAttribute('aria-pressed', 'true');
    expect(input).toHaveAttribute('type', 'text');
    fireEvent.click(reveal);
    expect(input).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: '发送' })).toHaveClass('ssh-auth-submit');
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
    await waitFor(() => expect(screen.getByText(/SSH 连接已关闭/)).toBeVisible());
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
  it('prints the failure output on the screen instead of a card', async () => {
    sessionView.status = 'closed';
    sessionView.frame.plainText = "user@server's password:\nConnection closed by server";
    sessionView.frame.html = "user@server's password:<br>Connection closed by server";
    render(<TerminalPanel paneId="p" tabId="t" onReady={() => {}} connectionInput sshTarget="user@server" />);
    expect(screen.getByRole('status')).toHaveTextContent('连接已断开');
    // 原因就当终端输出印在屏幕上（可选中复制），退出信息只补一次
    const ended = screen.getByTestId('ssh-terminal-ended');
    expect(ended).toHaveTextContent('Connection closed by server');
    expect(ended.textContent?.match(/\[进程已退出\]/g)).toHaveLength(1);
    expect(ended).toHaveAttribute('data-selectable', 'true');
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
    // 屏幕同时冻结成快照，点不进去也没有终端光标
    expect(screen.getByTestId('ssh-terminal-screen').tagName).toBe('PRE');
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
