import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import SshDashboard from '../components/SshDashboard';
import { useSshStore } from '../stores/store';
import { useHostLibrary } from '../stores/hostLibrary';
import { useSessionAuthenticationStore } from '../stores/sessionAuthentication';

const status = vi.hoisted(() => vi.fn());
vi.mock('../services/api', async importOriginal => ({ ...(await importOriginal<typeof import('../services/api')>()), sshSystemStatus: status }));
const snapshot = useSshStore.getState();
beforeEach(() => {
  localStorage.removeItem('vrykell-host-view-v2');
  status.mockResolvedValue({ system: 'Linux', cpuTotal: 100, cpuIdle: 80, memoryTotal: 100, memoryAvailable: 40, diskTotal: 100, diskUsed: 25 });
  useSshStore.setState({ loaded: true, loading: false, connections: [
    { id: 'ssh-1', name: 'Production', host: 'prod.test', port: 22, user: 'root', authMethod: 'password' },
    { id: 'ssh-2', name: 'Database', host: 'db.test', port: 22, user: 'ops', authMethod: 'key' },
  ] });
  useHostLibrary.setState({ hosts: {
    'ssh-1': { group: 'Tokyo', tags: ['production', 'api'], starred: true },
    'ssh-2': { group: 'Osaka', tags: ['database'], starred: false },
  } });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); useSshStore.setState(snapshot, true); useHostLibrary.setState({ hosts: {} }); localStorage.removeItem('vrykell-host-view-v2'); });

it('starts with one host list and only collects resources when explicitly enabled', async () => {
  render(<SshDashboard onManage={vi.fn()} onOpenTerminal={vi.fn()} />);
  expect(screen.getByRole('heading', { name: '主机' })).toBeVisible();
  expect(screen.getByRole('switch', { name: '资源占用' })).toHaveAttribute('aria-checked', 'false');
  expect(status).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('switch', { name: '资源占用' }));
  await waitFor(() => expect(status).toHaveBeenCalledTimes(2));
  expect(screen.getByTestId('ssh-row-ssh-1')).toHaveTextContent('在线');
  fireEvent.click(screen.getByRole('switch', { name: '资源占用' }));
  expect(screen.queryByText('在线')).toBeNull();
});

it('renders authentication failure in each row and retries without a separate alert', async () => {
  status.mockRejectedValue(new Error('Authentication failed'));
  render(<SshDashboard onManage={vi.fn()} onOpenTerminal={vi.fn()} />);
  fireEvent.click(screen.getByRole('switch', { name: '资源占用' }));
  await screen.findAllByText(/登录失败/);
  expect(screen.queryByRole('alert')).toBeNull();
  fireEvent.click(screen.getAllByRole('button', { name: '重试读取主机状态' })[0]);
  expect(useSessionAuthenticationStore.getState().request?.connectionId).toBe('ssh-1');
  useSessionAuthenticationStore.setState({ request: null });
});

it('switches layouts without turning selection into a details dialog', () => {
  const connect = vi.fn();
  render(<SshDashboard onManage={vi.fn()} onOpenTerminal={connect} />);
  fireEvent.click(screen.getByRole('button', { name: '卡片视图' }));
  const row = screen.getByTestId('ssh-row-ssh-1');
  fireEvent.click(row);
  expect(row).toHaveAttribute('data-active', 'true');
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '连接 Production' }));
  expect(connect).toHaveBeenCalledWith(expect.objectContaining({ id: 'ssh-1' }));
  expect(JSON.parse(localStorage.getItem('vrykell-host-view-v2')!).layout).toBe('cards');
});

it('combines favorites, folder and colored tag filters and clears each independently', () => {
  render(<SshDashboard onManage={vi.fn()} onOpenTerminal={vi.fn()} />);
  fireEvent.click(screen.getByTestId('ssh-host-favorites'));
  expect(screen.queryByTestId('ssh-row-ssh-2')).toBeNull();
  expect(screen.getByTestId('ssh-host-favorites').querySelector('svg')).toHaveStyle({ color: 'var(--favorite-color)' });
  fireEvent.click(screen.getByTestId('ssh-host-favorites'));
  fireEvent.click(screen.getByTestId('ssh-host-group-filter'));
  fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Osaka' }));
  expect(screen.queryByTestId('ssh-row-ssh-1')).toBeNull();
  expect(screen.getByRole('menuitemcheckbox', { name: 'Osaka' })).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByRole('menuitemcheckbox', { name: 'Osaka' }).querySelector('input')).toBeNull();
  fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Osaka' }));
  fireEvent.click(screen.getByTestId('ssh-host-tag-filter'));
  fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'api' }));
  expect(screen.getByRole('menuitemcheckbox', { name: 'api' })).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByRole('menuitemcheckbox', { name: 'api' }).querySelector('input')).toBeNull();
  expect(screen.queryByTestId('ssh-row-ssh-2')).toBeNull();
  expect(screen.getByTestId('ssh-row-ssh-1').querySelector('.sidebar-row-title svg')).toHaveStyle({ color: 'var(--favorite-color)' });
});

it.each(['卡片视图', '表格视图'])('centers unmatched hosts in %s and searches full connection addresses', layout => {
  render(<SshDashboard onManage={vi.fn()} onOpenTerminal={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: layout }));
  fireEvent.change(screen.getByTestId('ssh-search'), { target: { value: 'ssh root@prod.test' } });
  expect(screen.getByTestId('ssh-row-ssh-1')).toBeVisible();
  expect(screen.queryByTestId('ssh-row-ssh-2')).toBeNull();
  fireEvent.change(screen.getByTestId('ssh-search'), { target: { value: 'no-match' } });
  expect(screen.getByText('无匹配连接')).toHaveClass('search-empty-state');
  expect(screen.queryByTestId('ssh-row-ssh-1')).toBeNull();
});

it('returns to a valid host sort when resource display is disabled', () => {
  localStorage.setItem('vrykell-host-view-v2', JSON.stringify({ resources: true, sort: 'cpu' }));
  render(<SshDashboard onManage={vi.fn()} onOpenTerminal={vi.fn()} />);
  expect(screen.getByRole('combobox', { name: '主机列表顺序' })).toHaveTextContent('CPU');
  fireEvent.click(screen.getByRole('switch', { name: '资源占用' }));
  expect(screen.getByRole('combobox', { name: '主机列表顺序' })).toHaveTextContent('最近连接');
});

it('uses separate status and metric columns and exposes addresses only on hover', async () => {
  render(<SshDashboard onManage={vi.fn()} onOpenTerminal={vi.fn()} />);
  fireEvent.click(screen.getByRole('switch', { name: '资源占用' }));
  await screen.findAllByText('在线');
  const row = screen.getByTestId('ssh-row-ssh-1');
  expect(row).toHaveAttribute('data-tip', 'root@prod.test:22');
  expect(within(row).queryByText('root@prod.test:22')).toBeNull();
  expect(row.querySelector('.sidebar-row-subtitle')).toBeNull();
  expect(row.querySelector('.ssh-dashboard-table-status')).toHaveTextContent('在线');
  expect(row.querySelector('.ssh-dashboard-table-status')).not.toHaveAttribute('data-tip');
  expect(row.querySelectorAll('.ssh-dashboard-metric')).toHaveLength(3);
  expect(document.querySelector('.ssh-host-columns')).toHaveTextContent('名称状态CPU内存磁盘');
  fireEvent.click(screen.getByRole('switch', { name: '资源占用' }));
  expect(document.querySelector('.ssh-host-columns')).toHaveTextContent('名称地址标签最近连接');
  expect(row.querySelector('.sidebar-row-subtitle')).toHaveTextContent('root@prod.test:22');
  expect(row.querySelector('.ssh-host-tags')).toHaveTextContent('productionapi');
  expect(row.querySelector('.ssh-host-row-last-connected')).not.toBeNull();
});

it('opens real host details with Space and offers contextual connection and collection actions', async () => {
  const connect = vi.fn(); const remove = vi.fn();
  render(<SshDashboard onManage={vi.fn()} onOpenTerminal={connect} onDelete={remove} />);
  const row = screen.getByTestId('ssh-row-ssh-1');
  fireEvent.keyDown(row, { key: ' ' });
  expect(screen.getByRole('dialog', { name: '主机详情' })).toHaveTextContent('root@prod.test:22');
  fireEvent.click(screen.getByRole('button', { name: /^关闭$/ }));
  fireEvent.contextMenu(row);
  const menu = screen.getByRole('menu');
  for (const label of ['连接', '编辑连接', '复制主机', '复制地址', '重试', '不读取资源占用', '删除']) expect(within(menu).getByText(label, { exact: true })).toBeVisible();
  expect(within(menu).queryByText('查看详情')).toBeNull(); expect(menu.querySelector('svg')).toBeNull();
  fireEvent.click(within(menu).getByText('不读取资源占用', { exact: true }));
  expect(useHostLibrary.getState().hosts['ssh-1'].resourceDisabled).toBe(true);
  fireEvent.click(screen.getByRole('switch', { name: '资源占用' }));
  await waitFor(() => expect(status).toHaveBeenCalledTimes(1));
  expect(row).toHaveTextContent('未采集');
  fireEvent.contextMenu(row); fireEvent.click(screen.getByRole('menu').querySelector('button')!);
  expect(connect).toHaveBeenCalledWith(expect.objectContaining({ id: 'ssh-1' }));
  fireEvent.contextMenu(row); fireEvent.click(screen.getByRole('menu').querySelector('button:last-child')!);
  expect(remove).toHaveBeenCalledWith(expect.objectContaining({ id: 'ssh-1' }));
});

it('does not show last connection times on failed cards', async () => {
  status.mockRejectedValue(new Error('Connection refused'));
  render(<SshDashboard onManage={vi.fn()} onOpenTerminal={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '卡片视图' })); fireEvent.click(screen.getByRole('switch', { name: '资源占用' }));
  await screen.findAllByText('离线');
  expect(screen.getByTestId('ssh-row-ssh-1').querySelector('.ssh-host-last-connected')).toBeNull();
});
