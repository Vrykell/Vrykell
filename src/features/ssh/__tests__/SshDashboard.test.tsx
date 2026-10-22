import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import SshDashboard from '../components/SshDashboard';
import { useSshStore } from '../stores/store';

const status = vi.hoisted(() => vi.fn());
vi.mock('../services/api', async importOriginal => ({
  ...(await importOriginal<typeof import('../services/api')>()),
  sshSystemStatus: status,
}));

const snapshot = useSshStore.getState();
beforeEach(() => {
  status.mockResolvedValue({
    system: 'Linux', hostname: 'prod', latencyMs: 12, uptimeSeconds: 3600, load: '0.10 0.20 0.30',
    cpuTotal: 100, cpuIdle: 80, memoryTotal: 100, memoryAvailable: 40, diskTotal: 100, diskUsed: 25,
    networkReceived: 2048, networkTransmitted: 1024,
  });
  useSshStore.setState({
    loaded: true, loading: false,
    connections: [{ id: 'ssh-1', name: 'Production', host: 'prod.test', port: 22, user: 'root', authMethod: 'password' }],
  });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); useSshStore.setState(snapshot, true); });

it('renders the resource dashboard and exposes the management view', async () => {
  const manage = vi.fn();
  render(<SshDashboard onManage={manage} onOpenTerminal={vi.fn()} />);
  expect(screen.getByRole('heading', { name: '资源仪表盘' })).toBeVisible();
  await waitFor(() => expect(status).toHaveBeenCalled());
  expect(screen.getByTestId('ssh-dashboard-host-ssh-1')).toHaveTextContent('Production');
  fireEvent.click(screen.getByTestId('ssh-manage-hosts'));
  expect(manage).toHaveBeenCalledOnce();
});
