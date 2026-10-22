import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import NewTabModal from '../components/NewTabModal';
import { DEFAULT_AGENT_SETTINGS, useAgentSettings } from '@features/agent';
import { useTerminalDefaults } from '@config/terminalDefaults';
import { useSshStore } from '@features/ssh';
import { useSessionStore, useUiStore } from '@features/workspace';
import type { SshConnection } from '@features/ssh/services/api';
import { pickPath } from '@platform/api/fs';
import { openAppWindow } from '@platform/appWindows';

vi.mock('@platform/shells', async importOriginal => ({
  ...(await importOriginal<typeof import('@platform/shells')>()),
  getAvailableShells: vi.fn().mockResolvedValue([
    { id: 'zsh', label: 'Zsh', default: true },
    { id: 'bash', label: 'Bash', default: false },
    { id: 'cmd', label: 'CMD', default: false },
  ]),
}));

vi.mock('@features/ssh/components/SshFormModal', () => ({
  default: ({ open, initial }: { open: boolean; initial: SshConnection | null }) =>
    open ? <div data-testid="ssh-form-modal">{initial?.name}</div> : null,
}));
vi.mock('@platform/api/fs', async importOriginal => ({
  ...(await importOriginal<typeof import('@platform/api/fs')>()), pickPath: vi.fn().mockResolvedValue([]),
}));
vi.mock('@platform/appWindows', () => ({ openAppWindow: vi.fn() }));

const connection: SshConnection = {
  id: 'ssh-1', name: 'Prod', host: 'prod.example.com', port: 22, user: 'root', authMethod: 'password',
};
const save = vi.fn(async () => {});
const remove = vi.fn(async () => {});
const sshSnapshot = useSshStore.getState();
const agentSnapshot = useAgentSettings.getState();
const defaultsSnapshot = useTerminalDefaults.getState();
const workspaceSnapshot = useSessionStore.getState();
const uiSnapshot = useUiStore.getState();

beforeEach(() => {
  useTerminalDefaults.setState({ shell: 'system' });
  useAgentSettings.setState({ global: { ...DEFAULT_AGENT_SETTINGS } });
  useSshStore.setState({ connections: [connection], loaded: true, loading: false, save, remove });
  useSessionStore.setState({ tabs: [], activeId: '', groups: [] });
});

afterEach(() => {
  cleanup();
  useSshStore.setState(sshSnapshot, true);
  useAgentSettings.setState(agentSnapshot, true);
  useTerminalDefaults.setState(defaultsSnapshot, true);
  save.mockClear();
  remove.mockClear();
  vi.mocked(pickPath).mockReset().mockResolvedValue([]);
  vi.mocked(openAppWindow).mockClear();
  useSessionStore.setState(workspaceSnapshot, true);
  useUiStore.setState(uiSnapshot, true);
});

const openPicker = () => render(<NewTabModal open onClose={vi.fn()} />);

const rightClick = async (testId: string) => {
  const row = await screen.findByTestId(testId);
  fireEvent.contextMenu(row);
  return row;
};
const modes = () => fireEvent.click(screen.getByRole('menuitem', { name: '打开方式' }));

it('offers default-terminal and open-mode quick settings on a shell row', async () => {
  openPicker();
  await rightClick('new-tab-option-shell:zsh');
  expect(screen.queryByRole('menuitem', { name: '设置' })).toBeNull();
  expect(screen.getByRole('menuitemradio', { name: '设为默认终端' })).toHaveAttribute('aria-checked', 'true');
  modes();
  expect(screen.getByRole('menuitemradio', { name: '经典模式' })).toHaveAttribute('aria-checked', 'false');
  expect(screen.getByRole('menuitemradio', { name: '块模式' })).toHaveAttribute('aria-checked', 'true');
});

it('persists a shell open-mode change and closes the menu', async () => {
  openPicker();
  await rightClick('new-tab-option-shell:zsh');
  modes();
  fireEvent.click(screen.getByRole('menuitemradio', { name: '经典模式' }));

  expect(useAgentSettings.getState().global.openModeByShell.zsh).toBe('classic');
  expect(screen.queryByRole('menu')).toBeNull();
});

it('keeps CMD on classic mode only', async () => {
  openPicker();
  await rightClick('new-tab-option-shell:cmd');
  expect(screen.queryByRole('menuitem', { name: '打开方式' })).toBeNull();
  expect(screen.getByRole('menuitemradio', { name: '经典模式' })).toHaveAttribute('aria-checked', 'true');
  expect(screen.queryByRole('menuitemradio', { name: '块模式' })).toBeNull();
});

it('sets the right-clicked shell as the default terminal', async () => {
  openPicker();
  await rightClick('new-tab-option-shell:bash');
  fireEvent.click(screen.getByRole('menuitemradio', { name: '设为默认终端' }));

  expect(useTerminalDefaults.getState().shell).toBe('bash');
});

it('shows SSH connection shortcuts and saves a toggled flag', async () => {
  openPicker();
  await rightClick('new-tab-option-ssh:ssh-1');
  modes();
  expect(screen.getByRole('menuitemradio', { name: '经典模式' })).toHaveAttribute('aria-checked', 'true');
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
  expect(screen.getByRole('menuitemradio', { name: 'Shell 集成' })).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByRole('menuitemradio', { name: '自动重连' })).toHaveAttribute('aria-checked', 'false');
  fireEvent.click(screen.getByRole('menuitemradio', { name: '自动重连' }));

  expect(save).toHaveBeenCalledWith(expect.objectContaining({ id: 'ssh-1', autoReconnect: true }));
});

it('opens the SSH editor from the connection row', async () => {
  openPicker();
  await rightClick('new-tab-option-ssh:ssh-1');
  fireEvent.click(screen.getByText('编辑连接'));

  expect(screen.getByTestId('ssh-form-modal')).toHaveTextContent('Prod');
});

it('deletes a connection only after confirmation', async () => {
  openPicker();
  await rightClick('new-tab-option-ssh:ssh-1');
  fireEvent.click(screen.getByText('删除连接'));

  expect(remove).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog', { name: '删除 SSH 连接？' })).toBeVisible();
  fireEvent.click(screen.getByTestId('confirm-ok'));
  expect(remove).toHaveBeenCalledWith('ssh-1');
});

it('shows profile, location and advanced sections and reveals search from More profiles', async () => {
  openPicker();
  expect(screen.getByRole('heading', { name: '选择配置文件' })).toBeVisible();
  expect(screen.getByRole('heading', { name: '打开位置' })).toBeVisible();
  expect(screen.getByRole('heading', { name: '高级' })).toBeVisible();
  expect(await screen.findByRole('button', { name: /在新窗口中打开/ })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: '更多配置文件…' }));
  await vi.waitFor(() => expect(screen.getByPlaceholderText('搜索标签页类型…')).toHaveFocus());
});

it('uses the selected open location for the default profile', async () => {
  vi.mocked(pickPath).mockResolvedValueOnce(['/chosen/project']);
  openPicker();
  fireEvent.click(await screen.findByRole('button', { name: /选择目录/ }));
  await vi.waitFor(() => expect(screen.getByRole('button', { name: /\/chosen\/project/ })).toHaveAttribute('data-active', 'true'));
  await vi.waitFor(() => expect(screen.getByTestId('new-tab-default')).not.toBeDisabled());
  fireEvent.click(screen.getByTestId('new-tab-default'));
  const tabs = useSessionStore.getState().tabs;
  const tab = tabs[tabs.length - 1];
  expect(tab?.kind).toBe('session');
  if (tab?.kind !== 'session' || tab.layout.type !== 'leaf') throw new Error('Expected a local terminal');
  expect(tab.layout.terminal.cwd).toBe('/chosen/project');
});

it('routes the advanced split action to the shared placement picker', () => {
  const close = vi.fn();
  render(<NewTabModal open onClose={close} />);
  fireEvent.click(screen.getByRole('button', { name: '拆分标签页' }));
  expect(close).toHaveBeenCalledOnce();
  expect(useUiStore.getState().splitPlacement.open).toBe(true);
});

it('opens another application window from the advanced action', async () => {
  const close = vi.fn();
  render(<NewTabModal open onClose={close} />);
  fireEvent.click(await screen.findByRole('button', { name: /在新窗口中打开/ }));
  expect(openAppWindow).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
});
