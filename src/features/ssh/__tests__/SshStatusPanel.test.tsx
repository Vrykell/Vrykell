import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SshStatusPanel, { cpuUsage, statusDuration } from '../components/SshStatusPanel';
import type { SshSystemStatus } from '../services/api';
import { useState } from 'react';
import { useAuxiliarySidebarStore } from '@features/workspace/stores/auxiliarySidebar';
import { finishSshAuthentication, useSessionAuthenticationStore } from '../stores/sessionAuthentication';

const mocks = vi.hoisted(() => ({ collect: vi.fn(), copy: vi.fn() }));
vi.mock('../services/api', () => ({ sshSystemStatus: mocks.collect }));
vi.mock('@platform/clipboard', () => ({ writeClipboardText: mocks.copy }));
const sample: SshSystemStatus = { system: 'Linux 6.8', hostname: 'node', latencyMs: 42, uptimeSeconds: 90, load: '0.1 0.2 0.3', cpuTotal: 1000, cpuIdle: 700, memoryTotal: 8192, memoryAvailable: 4096, diskTotal: 10000, diskUsed: 3000 };
const target = { name: 'Production', host: 'example.com', user: 'deploy', connectionId: 'saved' };
const connected = { phase: 'connected' as const, reconnectAttempt: 0, retrying: false, log: [] };
const open = () => fireEvent.click(screen.getByTestId('ssh-status-toggle'));

beforeEach(() => { vi.clearAllMocks(); useSessionAuthenticationStore.setState({ request: null, revisions: {}, temporary: {} }); useAuxiliarySidebarStore.setState({ sshStatusOwner: null, dismissRequest: 0 }); mocks.collect.mockResolvedValue(sample); mocks.copy.mockResolvedValue(undefined); });
afterEach(() => vi.useRealTimers());

describe('SSH status panel', () => {
  it('lists one meter per resource with its percentage and used/total reading', async () => {
    render(<SshStatusPanel target={target} state={connected} active />);
    open();
    await screen.findByText('Linux 6.8 · node');
    const meters = screen.getAllByRole('meter').map(meter => [meter.getAttribute('aria-label'), meter.getAttribute('aria-valuenow')]);
    expect(meters).toEqual([['内存使用率', '50'], ['根分区使用率', '30']]);
    // CPU needs two samples: its reading stays unavailable instead of a zero-filled meter.
    expect(screen.getByText('不可用')).toBeInTheDocument();
    expect(screen.getByText('4.0 KB / 8.0 KB')).toBeInTheDocument();
    expect(screen.getByText('2.9 KB / 9.8 KB')).toBeInTheDocument();
  });

  it('shows the real connection log inside its box and expands from the empty state', () => {
    const log = [
      { time: 1_700_000_000_000, text: 'Warning: Permanently added host to the list of known hosts.' },
      { time: 1_700_000_001_000, text: '远端 Shell 就绪' },
    ];
    const view = render(<SshStatusPanel target={target} state={{ ...connected, log }} active />);
    open();
    const box = screen.getByTestId('ssh-status-panel').querySelector('.ssh-status-log')!;
    expect(box).toHaveTextContent('Warning: Permanently added host');
    expect(box).toHaveTextContent('远端 Shell 就绪');
    view.rerender(<SshStatusPanel target={target} state={{ ...connected, log: [] }} active />);
    expect(box).toHaveTextContent('暂无连接输出。');
  });

  it('keeps the status entry available before the classic toolbar mounts', () => {
    const toolbarReady = vi.fn();
    render(<SshStatusPanel target={target} state={{ ...connected, phase: 'connecting' }} active onToolbarReady={toolbarReady} />);
    const entry = screen.getByTestId('ssh-status-toggle');
    expect(entry).toHaveAttribute('data-tip', '查看 SSH 连接状态与资源');
    open();
    expect(screen.getByTestId('ssh-status-panel')).toBeVisible();
    expect(toolbarReady).toHaveBeenCalled();
  });
  it('mounts the status in the right sidebar while keeping terminal content mounted', async () => {
    const host = document.createElement('div'); host.id = 'ssh-status-sidebar-host'; document.body.append(host);
    const view = render(<SshStatusPanel paneId="ssh-pane" target={target} state={connected} active><div data-testid="terminal-content">Terminal</div></SshStatusPanel>);
    try {
      open(); await screen.findByText('Linux 6.8 · node');
      const panel = screen.getByTestId('ssh-status-panel');
      expect(panel.parentElement?.parentElement).toBe(host);
      expect(screen.getByTestId('terminal-content')).toBeVisible();
      const history = panel.querySelector('.ssh-status-history')!;
      expect(history).not.toHaveAttribute('open');
      fireEvent.click(history.querySelector('summary')!);
      expect(history).toHaveAttribute('open');
      expect(useAuxiliarySidebarStore.getState().sshStatusOwner).toBe('ssh-pane');
    } finally { view.unmount(); host.remove(); }
  });
  it('restores the previous sidebar when focus moves or its navigation is chosen', async () => {
    const host = document.createElement('div'); host.id = 'ssh-status-sidebar-host'; document.body.append(host);
    const view = render(<SshStatusPanel paneId="ssh-pane" target={target} state={connected} active focused />);
    try {
      open(); await screen.findByTestId('ssh-status-panel');
      view.rerender(<SshStatusPanel paneId="ssh-pane" target={target} state={connected} active focused={false} />);
      expect(host).toBeEmptyDOMElement();
      expect(useAuxiliarySidebarStore.getState().sshStatusOwner).toBeNull();
      view.rerender(<SshStatusPanel paneId="ssh-pane" target={target} state={connected} active focused />);
      expect(screen.getByTestId('ssh-status-panel')).toBeVisible();
      view.rerender(<SshStatusPanel paneId="ssh-pane" target={target} state={connected} active={false} focused />);
      expect(host).toBeEmptyDOMElement();
      view.rerender(<SshStatusPanel paneId="ssh-pane" target={target} state={connected} active focused />);
      expect(screen.getByTestId('ssh-status-panel')).toBeVisible();
      act(() => useAuxiliarySidebarStore.getState().dismissSshStatus());
      await waitFor(() => expect(host).toBeEmptyDOMElement());
    } finally { view.unmount(); host.remove(); }
  });
  it('resizes with the shared handle, clamps width and retains it after reopening', () => {
    function ResizablePanel() {
      const [width, setWidth] = useState(300);
      return <SshStatusPanel target={{ ...target, connectionId: undefined }} state={connected} active width={width} onWidthChange={setWidth} />;
    }
    render(<ResizablePanel />);
    open();
    const handle = screen.getByTestId('ssh-status-resize-handle');
    fireEvent.mouseDown(handle, { clientX: 400 });
    fireEvent.mouseMove(document, { clientX: 340 });
    fireEvent.mouseUp(document);
    expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '360');
    fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowLeft' });
    expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '376');
    open(); open();
    expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '376');
    fireEvent.mouseDown(screen.getByTestId('ssh-status-resize-handle'), { clientX: 400 });
    fireEvent.mouseMove(document, { clientX: -1000 });
    expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '560');
    fireEvent.mouseUp(document);
    open(); open();
    expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '560');
  });

  it('folds past the minimum while dragging, restores on drag back and closes when released there', () => {
    function ResizablePanel() {
      const [width, setWidth] = useState(300);
      return <SshStatusPanel target={{ ...target, connectionId: undefined }} state={connected} active width={width} onWidthChange={setWidth} />;
    }
    render(<ResizablePanel />);
    open();
    const handle = screen.getByTestId('ssh-status-resize-handle');
    fireEvent.mouseDown(handle, { clientX: 400 });
    fireEvent.mouseMove(document, { clientX: 700 });
    expect(screen.getByTestId('ssh-status-panel')).not.toBeVisible();
    expect(screen.getByTestId('ssh-status-resize-handle')).toBeInTheDocument();
    fireEvent.mouseMove(document, { clientX: 640 });
    expect(screen.getByTestId('ssh-status-panel')).toBeVisible();
    expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '300');
    fireEvent.mouseUp(document);
    expect(screen.getByTestId('ssh-status-panel')).toBeVisible();
    fireEvent.mouseDown(screen.getByTestId('ssh-status-resize-handle'), { clientX: 400 });
    fireEvent.mouseMove(document, { clientX: 800 });
    fireEvent.mouseUp(document);
    expect(screen.queryByTestId('ssh-status-panel')).not.toBeInTheDocument();
    expect(screen.getByTestId('ssh-status-toggle')).toHaveFocus();
    open();
    expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '300');
  });

  it('reconnects the owning session and does not poll while disconnected', async () => {
    const reconnect = vi.fn().mockResolvedValue(undefined);
    render(<SshStatusPanel target={target} state={{ ...connected, phase: 'disconnected' }} active onReconnect={reconnect} />);
    open();
    fireEvent.click(screen.getByRole('button', { name: '重新连接 SSH 会话' }));
    await waitFor(() => expect(reconnect).toHaveBeenCalledTimes(1));
    expect(mocks.collect).not.toHaveBeenCalled();
  });
  it('collects only when opened, copies the address and restores focus on Escape', async () => {
    render(<SshStatusPanel target={target} state={connected} active />);
    expect(mocks.collect).not.toHaveBeenCalled();
    open();
    await screen.findByText('Linux 6.8 · node');
    expect(mocks.collect).toHaveBeenCalledWith('saved', 'example.com', 22, 'deploy');
    expect(screen.getByText('50%')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '复制连接地址' }));
    expect(mocks.copy).toHaveBeenCalledWith('deploy@example.com:22');
    fireEvent.keyDown(screen.getByTestId('ssh-status-panel'), { key: 'Escape' });
    expect(screen.queryByTestId('ssh-status-panel')).not.toBeInTheDocument();
    expect(screen.getByTestId('ssh-status-toggle')).toHaveFocus();
  });

  it('keeps the last sample after disconnect and does not treat resource errors as terminal errors', async () => {
    const view = render(<SshStatusPanel target={target} state={connected} active />);
    open(); await screen.findByText('Linux 6.8 · node');
    mocks.collect.mockRejectedValueOnce(new Error('permission denied'));
    fireEvent.click(screen.getByRole('button', { name: '刷新远端资源' }));
    await screen.findByText('资源采集失败');
    expect(screen.getByText('终端连接与资源监控相互独立。')).toBeInTheDocument();
    expect(screen.queryByText('监控已暂停')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '暂停监控' })).toBeEnabled();
    expect(screen.getByText('Linux 6.8 · node').closest('[data-stale]')).toHaveAttribute('data-stale', 'true');
    view.rerender(<SshStatusPanel target={target} state={{ ...connected, phase: 'disconnected' }} active />);
    expect(screen.getByRole('button', { name: '刷新远端资源' })).toBeDisabled();
    expect(screen.getByText('最后一次采样', { exact: false })).toBeInTheDocument();
  });

  it('explains when saved credentials are rejected while the terminal stays connected', async () => {
    mocks.collect.mockRejectedValueOnce('[Session(-18)] Authentication failed (username/password)');
    render(<SshStatusPanel target={target} state={connected} active />);
    open();
    await screen.findByText('已保存的 SSH 认证信息被拒绝');
    expect(screen.getByText(/认证这两个服务/)).toBeInTheDocument();
    // The action matches the file panel's rendering of the same error.
    expect(screen.getByRole('button', { name: '认证服务' })).toHaveStyle({ minHeight: '36px' });
    expect(screen.getByRole('button', { name: '暂停监控' })).toBeEnabled();
  });

  it('stops automatic authentication retries and resumes after shared authentication succeeds', async () => {
    mocks.collect.mockRejectedValue('[Session(-18)] Username/PublicKey combination invalid');
    render(<SshStatusPanel target={target} state={connected} active />);
    open(); await screen.findByText('已保存的 SSH 认证信息被拒绝');
    vi.useFakeTimers();
    await act(async () => { vi.advanceTimersByTime(90000); });
    expect(mocks.collect).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
    fireEvent.click(screen.getByRole('button', { name: '认证服务' }));
    const requestId = useSessionAuthenticationStore.getState().request!.requestId;
    mocks.collect.mockResolvedValue(sample);
    act(() => finishSshAuthentication(requestId));
    await screen.findByText('Linux 6.8 · node');
    expect(mocks.collect).toHaveBeenCalledTimes(2);
  });

  it('does not collect for inactive, unsaved or jump host connections', async () => {
    const view = render(<SshStatusPanel target={target} state={connected} active={false} />);
    open(); expect(mocks.collect).not.toHaveBeenCalled();
    view.rerender(<SshStatusPanel target={{ ...target, connectionId: undefined }} state={connected} active />);
    expect(screen.getByText('保存此连接后可监控远端资源。')).toBeInTheDocument();
    view.rerender(<SshStatusPanel target={{ ...target, jumpHost: 'bastion' }} state={connected} active />);
    expect(screen.getByText('跳板机连接暂不支持资源监控。')).toBeInTheDocument();
    expect(mocks.collect).not.toHaveBeenCalled();
  });

  it('pauses polling and resumes it without overlapping requests', async () => {
    render(<SshStatusPanel target={target} state={connected} active />);
    open(); await screen.findByText('Linux 6.8 · node');
    fireEvent.click(screen.getByRole('button', { name: '暂停监控' }));
    vi.useFakeTimers();
    await act(async () => { vi.advanceTimersByTime(30000); });
    expect(mocks.collect).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
    fireEvent.click(screen.getByRole('button', { name: '恢复监控' }));
    await waitFor(() => expect(mocks.collect).toHaveBeenCalledTimes(2));
  });

  it('discards late responses when closed', async () => {
    let resolve!: (value: SshSystemStatus) => void;
    mocks.collect.mockReturnValue(new Promise<SshSystemStatus>(done => { resolve = done; }));
    render(<SshStatusPanel target={target} state={connected} active />);
    open(); open();
    await act(async () => resolve(sample));
    expect(screen.queryByText('Linux 6.8 · node')).not.toBeInTheDocument();
    mocks.collect.mockResolvedValue(sample);
    open(); await screen.findByText('Linux 6.8 · node');
  });

  it('derives CPU usage from consecutive counters and handles reboot or missing values', () => {
    expect(cpuUsage(sample, { ...sample, cpuTotal: 1200, cpuIdle: 800 })).toBe(50);
    expect(cpuUsage(null, sample)).toBeNull();
    expect(cpuUsage(sample, { ...sample, cpuTotal: 100 })).toBeNull();
    expect(cpuUsage(sample, { ...sample, cpuIdle: null })).toBeNull();
    expect(statusDuration(90)).toBe('1 分 30 秒');
    expect(statusDuration(3660)).toBe('1 小时 1 分');
    expect(statusDuration(90000)).toBe('1 天 1 小时');
  });
});
