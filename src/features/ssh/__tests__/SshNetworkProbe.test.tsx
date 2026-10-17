import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import SshNetworkProbe from '../components/SshNetworkProbe';
import type { NetworkProbe } from '../services/api';
import { StrictMode } from 'react';

const mocks = vi.hoisted(() => ({ probe: vi.fn() }));
vi.mock('../services/api', () => ({ sshNetworkProbe: mocks.probe }));
const result: NetworkProbe = { dnsMs: 1, attempts: [{ latencyMs: 20, errorKind: null }, { latencyMs: 40, errorKind: null }] };
beforeEach(() => { vi.clearAllMocks(); mocks.probe.mockResolvedValue(result); });
afterEach(() => vi.useRealTimers());

it('shares an in-flight check when strict effects mount twice', async () => {
  render(<StrictMode><SshNetworkProbe host="host" port={22} /></StrictMode>);
  await screen.findByText('可连通');
  expect(mocks.probe).toHaveBeenCalledTimes(1);
});

it('automatically probes and displays measured connectivity and latency', async () => {
  render(<SshNetworkProbe host="example.com" port={22} />);
  await screen.findByText('可连通');
  expect(mocks.probe).toHaveBeenCalledWith('example.com', 22);
  expect(screen.getByText('100%')).toBeInTheDocument();
  expect(screen.getByText('30.0 ms')).toBeInTheDocument();
  expect(screen.getByText('20.0 ms / 40.0 ms')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '重新探测' })).toBeEnabled();
});

it('shows interrupted connectivity without treating TCP failures as zero latency', async () => {
  mocks.probe.mockResolvedValue({ dnsMs: 2, attempts: [{ latencyMs: 20, errorKind: null }, { latencyMs: null, errorKind: 'timeout' }] });
  render(<SshNetworkProbe host="host" port={2222} />);
  await screen.findByText('连接不稳定');
  expect(screen.getByText('50%')).toBeInTheDocument();
  expect(screen.getByText('1/2 次成功')).toBeInTheDocument();
  expect(document.querySelector('[data-success="false"]')).toHaveAttribute('data-tip', '2 · 连接超时');
});

it('disables overlapping requests, resets on target changes and discards late results', async () => {
  let resolve!: (value: NetworkProbe) => void;
  mocks.probe.mockReturnValue(new Promise<NetworkProbe>(done => { resolve = done; }));
  const view = render(<SshNetworkProbe host="old" port={22} />);
  expect(screen.getByRole('button', { name: '探测中…' })).toBeDisabled();
  view.rerender(<SshNetworkProbe host="::1" port={2222} jumpHost="bastion" paused />);
  expect(screen.getByText('[::1]:2222')).toBeInTheDocument();
  expect(screen.getByText('探测目标的直连路径，不经过跳板机。')).toBeInTheDocument();
  await act(async () => resolve(result));
  expect(screen.queryByText('可连通')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '开始探测' })).toBeDisabled();
});

it('keeps a previous result with a readable error and allows retry', async () => {
  render(<SshNetworkProbe host="host" port={22} />);
  await screen.findByText('可连通');
  mocks.probe.mockRejectedValueOnce(new Error('Address resolution failed'));
  fireEvent.click(screen.getByRole('button', { name: '重新探测' }));
  await screen.findByText('网络探测失败');
  expect(screen.getByText('可连通')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '重新探测' }));
  await waitFor(() => expect(screen.queryByText('网络探测失败')).not.toBeInTheDocument());
});

it('repeats automatically, pauses with monitoring and skips hidden documents', async () => {
  vi.useFakeTimers();
  const view = render(<SshNetworkProbe host="host" port={22} />);
  await act(async () => {});
  expect(screen.getByText('可连通')).toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(mocks.probe).toHaveBeenCalledTimes(2);
  view.rerender(<SshNetworkProbe host="host" port={22} paused />);
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(mocks.probe).toHaveBeenCalledTimes(2);
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  view.rerender(<SshNetworkProbe host="host" port={22} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(mocks.probe).toHaveBeenCalledTimes(2);
  hidden.mockReturnValue(false);
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(mocks.probe).toHaveBeenCalledTimes(3);
  hidden.mockRestore();
});
