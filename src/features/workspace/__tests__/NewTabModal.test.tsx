import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import NewTabModal from '../components/NewTabModal';
import { DEFAULT_AGENT_SETTINGS, useAgentSettings } from '@features/agent';
import { useTerminalDefaults } from '@config/terminalDefaults';
import { useShellProfiles } from '@config/shellProfiles';
import { useSshStore, useHostEditor } from '@features/ssh';
import { useWorkspaceNavigation } from '../stores/navigation';
import { useSessionStore, useUiStore } from '@features/workspace';
import type { SshConnection } from '@features/ssh/services/api';
import { pickPath } from '@platform/api/fs';
import { openAppWindow } from '@platform/appWindows';
import { useSettingsNavigationStore } from '@features/settings';

vi.mock('@platform/appWindows', () => ({ openAppWindow: vi.fn() }));

vi.mock('@platform/shells', async importOriginal => ({
  ...(await importOriginal<typeof import('@platform/shells')>()),
  getAvailableShells: vi.fn().mockResolvedValue([
    { id: 'zsh', label: 'Zsh', default: true },
    { id: 'bash', label: 'Bash', default: false },
    { id: 'cmd', label: 'CMD', default: false },
  ]),
}));

vi.mock('@platform/api/fs', async importOriginal => ({
  ...(await importOriginal<typeof import('@platform/api/fs')>()), pickPath: vi.fn().mockResolvedValue([]),
}));

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
const navigationSnapshot = useWorkspaceNavigation.getState();

beforeEach(() => {
  useShellProfiles.setState({ profiles: {} });
  useTerminalDefaults.setState({ shell: 'system' });
  useAgentSettings.setState({ global: { ...DEFAULT_AGENT_SETTINGS } });
  useSshStore.setState({ connections: [connection], loaded: true, loading: false, save, remove });
  useSessionStore.setState({ tabs: [], activeId: '', groups: [] });
});

afterEach(() => {
  vi.mocked(openAppWindow).mockClear();
  cleanup();
  useSshStore.setState(sshSnapshot, true);
  useAgentSettings.setState(agentSnapshot, true);
  useTerminalDefaults.setState(defaultsSnapshot, true);
  save.mockClear();
  remove.mockClear();
  vi.mocked(pickPath).mockReset().mockResolvedValue([]);
  useSessionStore.setState(workspaceSnapshot, true);
  useUiStore.setState(uiSnapshot, true);
  useWorkspaceNavigation.setState(navigationSnapshot, true);
  useHostEditor.getState().close();
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

  expect(useHostEditor.getState().draft?.name).toBe('Prod');
  expect(useWorkspaceNavigation.getState().area).toBe('ssh');
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

it('shows compact profile, location and advanced sections with shared row styling', async () => {
  openPicker();
  expect(screen.getByRole('heading', { name: '选择配置文件' })).toBeVisible();
  expect(screen.getByRole('heading', { name: '打开位置' })).toBeVisible();
  expect(screen.getByRole('heading', { name: '高级' })).toBeVisible();
  expect(await screen.findByRole('button', { name: '拆分标签页' })).toHaveClass('workspace-floating-row');
  expect(screen.getByRole('button', { name: '更多配置文件…' })).toBeVisible();
  expect(screen.getByRole('button', { name: /在新窗口中打开/ })).toBeVisible();
  expect((await screen.findByTestId('new-tab-option-shell:zsh')).className).toContain('workspace-floating-row');
});

it('uses the selected open location for the default profile', async () => {
  vi.mocked(pickPath).mockResolvedValueOnce(['/chosen/project']);
  openPicker();
  fireEvent.click(await screen.findByRole('button', { name: /选择目录/ }));
  await vi.waitFor(() => expect(screen.getByRole('button', { name: /\/chosen\/project/ })).toHaveAttribute('data-active', 'true'));
  await screen.findByTestId('new-tab-option-shell:zsh');
  fireEvent.keyDown(screen.getByRole('dialog', { name: '新建标签页' }), { key: 't', ctrlKey: true, metaKey: true });
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

it('opens terminal configuration from the profile footer', async () => {
  openPicker();
  await screen.findByTestId('new-tab-option-shell:zsh');
  fireEvent.click(screen.getByRole('button', { name: '更多配置文件…' }));
  expect(useUiStore.getState().settingsOpen).toBe(true);
  expect(useSettingsNavigationStore.getState().selected).toBe('profile:zsh');
});

it('opens another application window and closes the picker', async () => {
  const close = vi.fn();
  render(<NewTabModal open onClose={close} />);
  await screen.findByTestId('new-tab-option-shell:zsh');
  fireEvent.click(screen.getByRole('button', { name: /在新窗口中打开/ }));
  expect(openAppWindow).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
});

it('marks the default profile independently of the hovered profile', async () => {
  openPicker();
  const row = await screen.findByTestId('new-tab-option-shell:zsh');
  fireEvent.mouseEnter(screen.getByTestId('new-tab-option-shell:bash'));
  expect(row.querySelector('[aria-label="默认终端"]')).not.toBeNull();
  expect(row.querySelector('kbd')).toBeNull();
});

it('keeps a hidden default profile available through the primary action', async () => {
  useTerminalDefaults.setState({ shell: 'bash' });
  useShellProfiles.getState().update('bash', { hidden: true });
  const pick = vi.fn();
  render(<NewTabModal open onClose={vi.fn()} onPick={pick} />);
  await screen.findByTestId('new-tab-option-shell:zsh');
  expect(screen.queryByTestId('new-tab-option-shell:bash')).toBeNull();
  fireEvent.keyDown(screen.getByRole('dialog', { name: '新建标签页' }), { key: 't', ctrlKey: true, metaKey: true });
  expect(pick).toHaveBeenCalledWith(expect.objectContaining({ shellType: 'bash' }));
});

it('creates a profile with its displayed number shortcut', async () => {
  const pick = vi.fn();
  render(<NewTabModal open onClose={vi.fn()} onPick={pick} />);
  const row = await screen.findByTestId('new-tab-option-shell:bash');
  const shortcut = row.querySelector('kbd')!.getAttribute('aria-label')!.split('+');
  fireEvent.keyDown(screen.getByRole('dialog'), { key: shortcut[1], ctrlKey: true });
  expect(pick).toHaveBeenCalledWith(expect.objectContaining({ shellType: 'bash' }));
});

it('lets a focused location button handle Enter without creating a profile', async () => {
  const pick = vi.fn();
  render(<NewTabModal open onClose={vi.fn()} onPick={pick} />);
  await screen.findByTestId('new-tab-option-shell:zsh');
  fireEvent.keyDown(screen.getByRole('button', { name: /在用户主目录打开/ }), { key: 'Enter' });
  expect(pick).not.toHaveBeenCalled();
});

it('preserves the chosen directory when returning a split terminal specification', async () => {
  vi.mocked(pickPath).mockResolvedValueOnce(['/split/project']);
  const pick = vi.fn();
  render(<NewTabModal open onClose={vi.fn()} onPick={pick} />);
  fireEvent.click(screen.getByRole('button', { name: /选择目录/ }));
  await screen.findByRole('button', { name: /\/split\/project/ });
  fireEvent.click(await screen.findByTestId('new-tab-option-shell:zsh'));
  expect(pick).toHaveBeenCalledWith(expect.objectContaining({ shellType: 'zsh', cwd: '/split/project' }));
  expect(screen.queryByRole('button', { name: /在新窗口中打开/ })).toBeNull();
});
