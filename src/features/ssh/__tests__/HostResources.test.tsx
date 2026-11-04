import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { HostResources } from '../components/SshDashboard';
import { HOST_METRICS, type HostMetricSelection } from '../hooks/useHostResources';

const metrics = Object.fromEntries(HOST_METRICS.map(metric => [metric, true])) as HostMetricSelection;
afterEach(cleanup);

it('shows login failure inside the card with a visible retry action and pending feedback', async () => {
  const retry = vi.fn();
  render(<HostResources compact state={{ error: 'SSH_AUTH_FAILED: rejected' }} metrics={metrics} onRetry={retry} />);
  expect(screen.getByRole('status')).toHaveTextContent('登录失败');
  expect(screen.getByText('认证失败：用户名、密码或密钥不被服务器接受。')).toBeVisible();
  const button = screen.getByRole('button', { name: '重试读取主机状态' });
  expect(button).toHaveClass('outline-button');
  await act(async () => { fireEvent.click(button); });
  expect(retry).toHaveBeenCalledOnce();
  expect(button).toHaveAttribute('aria-busy', 'true');
  fireEvent.click(button);
  expect(retry).toHaveBeenCalledOnce();
});

it('places successful read and recent connection times in one footer and retains stale read time', () => {
  const state = { updatedAt: 1_700_000_000_000, data: { system: 'Linux', hostname: 'test', latencyMs: 1, uptimeSeconds: 1, load: '', cpuTotal: null, cpuIdle: null, memoryTotal: null, memoryAvailable: null, diskTotal: null, diskUsed: null } };
  const { container, rerender } = render(<HostResources compact recentConnection="Yesterday" state={state} metrics={metrics} onRetry={vi.fn()} />);
  expect(container.querySelector('.ssh-host-card-times')).toHaveTextContent('Yesterday最后读取于');
  rerender(<HostResources compact recentConnection="Yesterday" state={{ ...state, error: 'Read failed' }} metrics={metrics} onRetry={vi.fn()} />);
  expect(screen.queryByText('Yesterday')).toBeNull();
  expect(container.querySelector('.ssh-host-card-times')).toHaveTextContent('最后读取于');
  expect(screen.getByRole('button', { name: '重试读取主机状态' })).toHaveClass('outline-button');
});

it('shows a concise unsupported-resource message and preserves technical details', () => {
  const error = 'SSH_CONNECTION_FAILED:' + JSON.stringify({ connectionId: 'test', host: 'test.example', port: 22, stage: 'resource-collection', cause: 'Remote system does not support resource collection' });
  render(<HostResources compact state={{ error }} metrics={metrics} onRetry={vi.fn()} />);
  expect(screen.getByText('此主机不支持资源采集。')).toHaveAttribute('data-tip', error);
  expect(screen.getByRole('status')).not.toHaveTextContent('SSH_CONNECTION_FAILED:');
});

it('distinguishes an offline card from a read failure without an error popup', () => {
  const { rerender } = render(<HostResources compact state={{ error: 'Connection refused' }} metrics={metrics} onRetry={vi.fn()} />);
  expect(screen.getByRole('status')).toHaveTextContent('离线');
  expect(screen.queryByRole('button')).toBeNull();
  rerender(<HostResources compact state={{ error: 'Permission denied reading metrics' }} metrics={metrics} onRetry={vi.fn()} />);
  expect(screen.getByRole('status')).toHaveTextContent('读取失败');
  expect(screen.getByRole('button', { name: '重试读取主机状态' })).toBeVisible();
});

it('omits empty tracks while retaining valid zero percent readings', () => {
  const { container, rerender } = render(<HostResources state={{}} metrics={metrics} onRetry={vi.fn()} />);
  expect(container.querySelectorAll('.ssh-dashboard-metric i')).toHaveLength(0);
  expect(container.querySelectorAll('.ssh-dashboard-metric[data-empty="true"]')).toHaveLength(3);
  rerender(<HostResources state={{ cpu: 0 }} metrics={metrics} onRetry={vi.fn()} />);
  expect(container.querySelectorAll('.ssh-dashboard-metric i')).toHaveLength(1);
  expect(screen.getByText('0%')).toBeVisible();
});
