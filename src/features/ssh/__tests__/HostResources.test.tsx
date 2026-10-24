import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { HostResources } from '../components/SshDashboard';
import { HOST_METRICS, type HostMetricSelection } from '../hooks/useHostResources';

const metrics = Object.fromEntries(HOST_METRICS.map(metric => [metric, true])) as HostMetricSelection;
afterEach(cleanup);

it('shows login failure inside the card with a real retry action', () => {
  const retry = vi.fn();
  render(<HostResources compact state={{ error: 'SSH_AUTH_FAILED: rejected' }} metrics={metrics} onRetry={retry} />);
  expect(screen.getByRole('status')).toHaveTextContent('登录失败');
  expect(screen.getByText('认证失败：用户名、密码或密钥不被服务器接受。')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '重试读取主机状态' }));
  expect(retry).toHaveBeenCalledOnce();
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
