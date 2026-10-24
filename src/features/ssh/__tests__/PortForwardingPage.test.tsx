import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import PortForwardingPage from '../components/PortForwardingPage';
import { useSshStore } from '../stores/store';
import { connectionRules, withForwardingRules } from '../services/forwarding';
import type { SshForwardingRule } from '@core/ssh';

const api = vi.hoisted(() => ({ list: vi.fn(), start: vi.fn(), stop: vi.fn() }));
vi.mock('../services/forwarding', async original => ({ ...await original<typeof import('../services/forwarding')>(), listForwardingStatus: api.list, startForwarding: api.start, stopForwarding: api.stop }));
const snapshot = useSshStore.getState();
const rule: SshForwardingRule = { id: 'forward-1', name: 'Database', kind: 'local', bind: '127.0.0.1', port: 15432, host: 'localhost', targetPort: 5432, autoStart: true };
const connection = { id: 'host-1', name: 'Production', host: 'server', user: 'ops', authMethod: 'key' as const, forwardingRules: [rule] };
beforeEach(() => {
  api.list.mockResolvedValue([]); api.start.mockResolvedValue(undefined); api.stop.mockResolvedValue(undefined);
  useSshStore.setState({ loaded: true, loading: false, connections: [connection], save: vi.fn().mockResolvedValue(undefined) });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); useSshStore.setState(snapshot, true); });

it('migrates legacy startup forwards without keeping duplicate client listeners', () => {
  const legacy = { ...connection, forwardingRules: undefined, localForwards: ['8080:localhost:80'], dynamicForwards: ['1080'] };
  const rules = connectionRules(legacy);
  expect(rules).toHaveLength(2); expect(rules[0].autoStart).toBe(true);
  expect(withForwardingRules(legacy, rules)).toMatchObject({ forwardingRules: rules, localForwards: [], remoteForwards: [], dynamicForwards: [] });
});
it('starts and stops the selected rule through the backend', async () => {
  render(<PortForwardingPage />);
  fireEvent.click(await screen.findByRole('button', { name: '启动' }));
  await waitFor(() => expect(api.start).toHaveBeenCalledWith('host-1', 'forward-1'));
  cleanup(); api.list.mockResolvedValue([{ id: 'host-1/forward-1', running: true, error: null }]);
  render(<PortForwardingPage />);
  fireEvent.click(await screen.findByRole('button', { name: '停止' }));
  await waitFor(() => expect(api.stop).toHaveBeenCalledWith('host-1', 'forward-1'));
});
it('opens a compact three-way editor and preserves unsaved edits on cancel', async () => {
  render(<PortForwardingPage />);
  fireEvent.click(screen.getByRole('button', { name: '编辑转发规则' }));
  fireEvent.click(screen.getByRole('combobox', { name: '转发类型' }));
  expect(screen.getAllByRole('option')).toHaveLength(3);
  fireEvent.click(screen.getByRole('option', { name: '动态（SOCKS）' }));
  fireEvent.change(screen.getByTestId('forward-name'), { target: { value: 'Changed' } });
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(screen.getByRole('dialog', { name: '放弃更改？' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
  expect(screen.getByTestId('forward-name')).toHaveValue('Changed');
});
it('persists imported rules before starting them independently', async () => {
  useSshStore.setState({ connections: [{ ...connection, forwardingRules: undefined, localForwards: ['8080:localhost:80'] }] });
  render(<PortForwardingPage />);
  fireEvent.click(screen.getByRole('button', { name: '启动' }));
  await waitFor(() => expect(useSshStore.getState().save).toHaveBeenCalledWith(expect.objectContaining({ localForwards: [], forwardingRules: [expect.objectContaining({ kind: 'local', port: 8080 })] })));
  await waitFor(() => expect(api.start).toHaveBeenCalledWith('host-1', 'forward-0'));
});
it('does not poll an inactive page and reports backend failures inline', async () => {
  const view = render(<PortForwardingPage active={false} />);
  expect(api.list).not.toHaveBeenCalled();
  view.rerender(<PortForwardingPage />);
  api.start.mockRejectedValue(new Error('Port is occupied'));
  fireEvent.click(screen.getByRole('button', { name: '启动' }));
  expect(await screen.findByText('端口转发失败')).toBeVisible();
});
