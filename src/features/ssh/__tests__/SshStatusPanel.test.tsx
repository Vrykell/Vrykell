import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SshStatusPanel, { cpuUsage, statusDuration } from '../components/SshStatusPanel';
import type { SshSystemStatus } from '../services/api';
import { useState } from 'react';
import { useAuxiliarySidebarStore } from '@features/workspace/stores/auxiliarySidebar';
import { finishSshAuthentication, useSessionAuthenticationStore } from '../stores/sessionAuthentication';

const mocks = vi.hoisted(() => ({ collect: vi.fn(), copy: vi.fn(), probe: vi.fn() }));
vi.mock('../services/api', () => ({ sshSystemStatus: mocks.collect, sshNetworkProbe: mocks.probe }));
vi.mock('@platform/clipboard', () => ({ writeClipboardText: mocks.copy }));
const sample: SshSystemStatus = { system: 'Linux 6.8', hostname: 'node', latencyMs: 42, uptimeSeconds: 90, load: '0.1 0.2 0.3', cpuTotal: 1000, cpuIdle: 700, memoryTotal: 8192, memoryAvailable: 4096, diskTotal: 10000, diskUsed: 3000 };
const target = { name: 'Production', host: 'example.com', user: 'deploy', connectionId: 'saved' };
const connected = { phase: 'connected' as const, reconnectAttempt: 0, retrying: false, log: [] };
const open = () => fireEvent.click(screen.getByTestId('ssh-status-toggle'));

beforeEach(() => { vi.clearAllMocks(); mocks.probe.mockResolvedValue({ dnsMs: 1, attempts: [] }); useSessionAuthenticationStore.setState({ request: null, revisions: {}, temporary: {} }); useAuxiliarySidebarStore.setState({ sshStatusOwner: null, dismissRequest: 0 }); mocks.collect.mockResolvedValue(sample); mocks.copy.mockResolvedValue(undefined); });
afterEach(() => vi.useRealTimers());

describe('SSH status panel', () => {
  it('lists text percentages and detail readings without utilization bars', async () => {
    render(<SshStatusPanel target={target} state={connected} active />);
    open();
    await screen.findByText('Linux 6.8');
    expect(screen.getByTestId('ssh-resource-memory')).toHaveTextContent('50%');
    expect(screen.getByTestId('ssh-resource-disk')).toHaveTextContent('30%');
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    // CPU needs two samples before its percentage is available.
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

  it('keeps one combined resource chart and current text readings visible together', async () => {
    render(<SshStatusPanel target={target} state={connected} active />);
    open(); await screen.findByText('Linux 6.8');
    const chart = screen.getByRole('img', { name: '资源使用率趋势' });
    expect(chart.querySelectorAll('[data-series]')).toHaveLength(3);
    expect(chart.querySelector('[data-series="CPU"] circle')).not.toBeInTheDocument();
    expect(screen.getByRole('list', { name: '资源图例' })).toHaveTextContent('CPU内存根分区');
    expect(screen.getByTestId('ssh-resource-memory')).toHaveTextContent('50%');
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(mocks.collect).toHaveBeenCalledTimes(1);
    open(); open();
    expect(screen.getByRole('img', { name: '资源使用率趋势' })).toBeInTheDocument();
    expect(screen.getByTestId('ssh-resource-memory')).toBeInTheDocument();
  });

  it('updates the combined chart and all current readings from the same sample', async () => {
    render(<SshStatusPanel target={target} state={connected} active />);
    open(); await screen.findByText('Linux 6.8');
    mocks.collect.mockResolvedValueOnce({ ...sample, cpuTotal: 1200, cpuIdle: 800, memoryAvailable: 2048 });
    fireEvent.click(screen.getByRole('button', { name: '刷新远端资源' }));
    await waitFor(() => expect(screen.getByTestId('ssh-resource-cpu')).toHaveTextContent('50%'));
    expect(screen.getByTestId('ssh-resource-memory')).toHaveTextContent('75%');
    expect(screen.getByTestId('ssh-resource-disk')).toHaveTextContent('30%');
    expect(screen.getByText('50% 空闲')).toHaveClass('ssh-status-metric-caption');
    expect(document.querySelectorAll('.ssh-status-metric-caption')).toHaveLength(3);
    expect(screen.getByRole('img', { name: '资源使用率趋势' }).querySelector('[data-series="CPU"] circle')).toBeInTheDocument();
    mocks.collect.mockResolvedValueOnce({ ...sample, cpuTotal: 1400, cpuIdle: 899 });
    fireEvent.click(screen.getByRole('button', { name: '刷新远端资源' }));
    await waitFor(() => expect(screen.getByTestId('ssh-resource-cpu')).toHaveTextContent('51%'));
    expect(screen.getByText('49% 空闲')).toBeInTheDocument();
  });

  it('keeps a detail row for every resource when its measurements are unavailable', async () => {
    mocks.collect.mockResolvedValueOnce({ ...sample, cpuTotal: null, cpuIdle: null, memoryTotal: null, memoryAvailable: null, diskUsed: null, diskTotal: null });
    render(<SshStatusPanel target={target} state={connected} active />);
    open(); await screen.findByText('Linux 6.8');
    expect(document.querySelectorAll('.ssh-status-metric-caption')).toHaveLength(3);
    expect(screen.getAllByText('用量详情不可用')).toHaveLength(3);
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
  });

  it('separates system identity and load periods from collapsible connection facts', async () => {
    render(<SshStatusPanel target={target} state={connected} active />);
    open(); await screen.findByText('Linux 6.8');
    expect(screen.getByText('node')).toBeInTheDocument();
    const system = screen.getByText('系统信息').closest('details')!;
    expect(system).not.toHaveAttribute('open');
    fireEvent.click(system.querySelector('summary')!);
    expect(screen.getByText('1 分钟')).toBeInTheDocument();
    expect(screen.getByText('5 分钟')).toBeInTheDocument();
    expect(screen.getByText('15 分钟')).toBeInTheDocument();
    const connection = screen.getByText('连接详情').closest('details')!;
    expect(connection).not.toHaveAttribute('open');
    fireEvent.click(connection.querySelector('summary')!);
    expect(screen.getByText('探测延迟')).toBeVisible();
  });

  it('clears previous resource samples when the connection target changes', async () => {
    const view = render(<SshStatusPanel target={target} state={connected} active />);
    open(); await screen.findByText('Linux 6.8');
    mocks.collect.mockReturnValue(new Promise(() => {}));
    view.rerender(<SshStatusPanel target={{ ...target, connectionId: 'other', host: 'other.example.com' }} state={connected} active />);
    expect(screen.queryByText('Linux 6.8')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ssh-resource-memory')).not.toBeInTheDocument();
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
      open(); await screen.findByText('Linux 6.8');
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
    await screen.findByText('Linux 6.8');
    expect(mocks.collect).toHaveBeenCalledWith('saved', 'example.com', 22, 'deploy');
    expect(screen.getByTestId('ssh-resource-memory')).toHaveTextContent('50%');
    const address = screen.getByText('deploy@example.com:22');
    expect(address.tagName).toBe('STRONG');
    expect(address.closest('header')).not.toBeNull();
    expect(address).toHaveAttribute('data-tip', 'deploy@example.com:22');
    expect(screen.queryByText('Production')).not.toBeInTheDocument();
    expect(screen.queryByText('远端资源')).not.toBeInTheDocument();
    expect(screen.getByTestId('ssh-status-panel')).not.toHaveTextContent('已连接');
    expect(screen.queryByText('本机')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '复制连接地址' })).toHaveAttribute('data-compact', 'true');
    fireEvent.click(screen.getByRole('button', { name: '复制连接地址' }));
    expect(mocks.copy).toHaveBeenCalledWith('deploy@example.com:22');
    fireEvent.keyDown(screen.getByTestId('ssh-status-panel'), { key: 'Escape' });
    expect(screen.queryByTestId('ssh-status-panel')).not.toBeInTheDocument();
    expect(screen.getByTestId('ssh-status-toggle')).toHaveFocus();
  });

  it.each([
    { host: '10.21.76.57', user: 'topview', port: 2222, address: 'topview@10.21.76.57:2222' },
    { host: '::1', user: undefined, port: 22, address: '[::1]:22' },
    { host: '[2001:db8::1]', user: 'deploy', port: 2222, address: 'deploy@[2001:db8::1]:2222' },
  ])('shows and copies the complete endpoint $address', async ({ address, ...endpoint }) => {
    render(<SshStatusPanel target={{ ...target, ...endpoint }} state={connected} active />);
    open();
    await screen.findByText('Linux 6.8');
    expect(screen.getByText(address).tagName).toBe('STRONG');
    fireEvent.click(screen.getByRole('button', { name: '复制连接地址' }));
    expect(mocks.copy).toHaveBeenCalledWith(address);
  });

  it('keeps the last sample after disconnect and does not treat resource errors as terminal errors', async () => {
    const view = render(<SshStatusPanel target={target} state={connected} active />);
    open(); await screen.findByText('Linux 6.8');
    mocks.collect.mockRejectedValueOnce(new Error('permission denied'));
    fireEvent.click(screen.getByRole('button', { name: '刷新远端资源' }));
    await screen.findByText('资源采集失败');
    expect(screen.getByText('终端连接与资源监控相互独立。')).toBeInTheDocument();
    expect(screen.queryByText('监控已暂停')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '暂停监控' })).toBeEnabled();
    expect(screen.getByText('Linux 6.8').closest('[data-stale]')).toHaveAttribute('data-stale', 'true');
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
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(mocks.collect).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
    fireEvent.click(screen.getByRole('button', { name: '认证服务' }));
    const requestId = useSessionAuthenticationStore.getState().request!.requestId;
    mocks.collect.mockResolvedValue(sample);
    act(() => finishSshAuthentication(requestId));
    await screen.findByText('Linux 6.8');
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
    open(); await screen.findByText('Linux 6.8');
    fireEvent.click(screen.getByRole('button', { name: '暂停监控' }));
    vi.useFakeTimers();
    await act(async () => { vi.advanceTimersByTime(30000); });
    expect(mocks.collect).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
    fireEvent.click(screen.getByRole('button', { name: '恢复监控' }));
    await waitFor(() => expect(mocks.collect).toHaveBeenCalledTimes(2));
  });

  it('appends automatic samples and keeps the plotted time fixed between responses', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    mocks.collect.mockImplementation(async () => {
      const count = mocks.collect.mock.calls.length;
      return { ...sample, cpuTotal: count * 1000, cpuIdle: count * 880, networkReceived: count * 153600, networkTransmitted: count * 76800 };
    });
    const view = render(<SshStatusPanel target={target} state={connected} active />);
    open(); await act(async () => {});
    expect(mocks.collect).toHaveBeenCalledTimes(1);
    const chart = screen.getByRole('img', { name: '资源使用率趋势' });
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(mocks.collect).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('ssh-resource-cpu')).toHaveTextContent('12%');
    const points = chart.querySelector('[data-series="CPU"] circle')!.getAttribute('cx');
    const frame = chart.closest('.ssh-resource-chart')!;
    expect(frame).toHaveAttribute('data-end-time', '15000');
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(frame).toHaveAttribute('data-end-time', '15000');
    expect(chart.querySelector('[data-series="CPU"] circle')).toHaveAttribute('cx', points);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(mocks.collect).toHaveBeenCalledTimes(3);
    expect(chart.querySelector('[data-series="CPU"] polyline')!.getAttribute('points')!.split(' ')).toHaveLength(2);
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(mocks.collect).toHaveBeenCalledTimes(3);
    hidden.mockReturnValue(false);
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(mocks.collect).toHaveBeenCalledTimes(4);
    hidden.mockRestore();
    view.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(mocks.collect).toHaveBeenCalledTimes(4);
  });

  it('discards late responses when closed', async () => {
    let resolve!: (value: SshSystemStatus) => void;
    mocks.collect.mockReturnValue(new Promise<SshSystemStatus>(done => { resolve = done; }));
    render(<SshStatusPanel target={target} state={connected} active />);
    open(); open();
    await act(async () => resolve(sample));
    expect(screen.queryByText('Linux 6.8')).not.toBeInTheDocument();
    mocks.collect.mockResolvedValue(sample);
    open(); await screen.findByText('Linux 6.8');
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
