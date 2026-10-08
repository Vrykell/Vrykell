import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useSessionStore } from '@features/workspace';
import { firstLeaf, leaf } from '@features/workspace/model/windowLayout';
import SshSessionGate from '../components/SshSessionGate';
import { listSshConnections } from '@features/ssh/services/api';
vi.mock('@features/ssh/services/api', async importOriginal => ({ ...(await importOriginal<typeof import('@features/ssh/services/api')>()), listSshConnections: vi.fn() }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); useSessionStore.setState({ tabs: [], activeId: '' }); });
it('does not mount the connecting terminal for a deleted profile and lets the user reconnect independently', async () => {
  vi.mocked(listSshConnections).mockResolvedValue([]);
  useSessionStore.setState({ tabs: [{ id: 'tab', title: 'Saved', kind: 'session', layout: leaf({ id: 'pane', kind: 'ssh', ssh: { name: 'Saved', host: 'saved.test', connectionId: 'deleted' } }) }], activeId: 'tab' });
  await act(async () => { render(<SshSessionGate connectionId="deleted" paneId="pane" tabId="tab"><div>Connecting terminal</div></SshSessionGate>); });
  expect(screen.queryByText('Connecting terminal')).not.toBeInTheDocument();
  expect(screen.getByText('原 SSH 连接已被删除')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '使用历史地址连接' }));
  const tab = useSessionStore.getState().tabs[0]!;
  expect(tab.kind === 'session' && firstLeaf(tab.layout).ssh).toEqual({ name: 'Saved', host: 'saved.test', connectionId: undefined });
});
it('mounts the terminal only after the connection reference is verified', async () => {
  vi.mocked(listSshConnections).mockResolvedValue([{ id: 'live', name: 'Live', host: 'live.test', user: '', authMethod: 'key' }]);
  await act(async () => { render(<SshSessionGate connectionId="live" paneId="pane" tabId="tab"><div>Connecting terminal</div></SshSessionGate>); });
  expect(screen.getByText('Connecting terminal')).toBeVisible();
});
it('offers a retry when profile lookup fails and can verify the reference on the next attempt', async () => {
  vi.mocked(listSshConnections).mockRejectedValueOnce(new Error('lookup unavailable'))
    .mockResolvedValueOnce([{ id: 'live', name: 'Live', host: 'live.test', user: '', authMethod: 'key' }]);
  await act(async () => { render(<SshSessionGate connectionId="live" paneId="pane" tabId="tab"><div>Connected terminal</div></SshSessionGate>); });
  expect(screen.queryByText('Connected terminal')).not.toBeInTheDocument();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '重试' })); });
  expect(screen.getByText('Connected terminal')).toBeVisible();
});
