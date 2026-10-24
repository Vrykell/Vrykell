import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import TerminalLauncher from '../components/TerminalLauncher';
import { useSessionStore } from '../model/session/store';
import { useSshStore } from '@features/ssh';
import { useShellProfiles } from '@config/shellProfiles';
import { useSettingsNavigationStore } from '@features/settings/stores/navigation';
import { useUiStore } from '../stores/ui';

vi.mock('@platform/shells', async original => ({ ...await original<typeof import('@platform/shells')>(), getAvailableShells: vi.fn().mockResolvedValue([
  { id: 'zsh', label: 'Zsh', default: true }, { id: 'bash', label: 'Bash', default: false },
]) }));

const workspace = useSessionStore.getState();
const ssh = useSshStore.getState();
const ui = useUiStore.getState();
beforeEach(() => {
  useSessionStore.setState({ tabs: [], activeId: '' });
  useShellProfiles.setState({ profiles: { zsh: { name: 'Work shell', cwd: '/work', tabTitle: '', hidden: false } } });
  useSshStore.setState({ loaded: true, connections: [{ id: 'prod', name: 'Production', host: 'prod.test', user: 'root', port: 2222, authMethod: 'password' }], touch: vi.fn().mockResolvedValue(undefined) });
});
afterEach(() => {
  cleanup(); useSessionStore.setState(workspace, true); useSshStore.setState(ssh, true); useUiStore.setState(ui, true); useShellProfiles.setState({ profiles: {} });
});

it('shows configured shell profiles, host totals and zero active terminals', async () => {
  render(<TerminalLauncher />);
  expect(await screen.findByTestId('terminal-start-profile-zsh')).toHaveTextContent('Work shell');
  expect(screen.getByTestId('terminal-start-profile-zsh')).toHaveTextContent('/work');
  expect(screen.getByText('已打开终端').nextElementSibling).toHaveTextContent('0');
  expect(screen.getByText('Shell 配置文件', { selector: 'dt' }).nextElementSibling).toHaveTextContent('2');
  expect(screen.getByText('已保存主机', { selector: 'dt' }).nextElementSibling).toHaveTextContent('1');
  fireEvent.change(screen.getByRole('textbox', { name: '搜索 Shell 配置' }), { target: { value: 'no-match' } });
  expect(screen.getByText('没有匹配的配置')).toBeVisible();
  expect(screen.queryByTestId('terminal-start-profile-zsh')).toBeNull();
});

it('opens the selected shell, configures profiles and launches a saved host', async () => {
  render(<TerminalLauncher />);
  fireEvent.click(await screen.findByTestId('terminal-start-profile-bash'));
  const local = useSessionStore.getState().tabs.find(tab => tab.kind === 'session');
  expect(local?.layout).toMatchObject({ type: 'leaf', terminal: { kind: 'local', shellType: 'bash' } });
  fireEvent.click(screen.getByRole('button', { name: '配置 Shell' }));
  expect(useSettingsNavigationStore.getState().selected).toMatch(/^profile:/);
  expect(useUiStore.getState().settingsOpen).toBe(true);
  fireEvent.click(screen.getByTestId('terminal-start-host-prod'));
  expect(useSshStore.getState().touch).toHaveBeenCalledWith('prod');
  const tabs = useSessionStore.getState().tabs;
  const remote = tabs[tabs.length - 1];
  expect(remote.kind).toBe('session');
  expect(remote.kind === 'session' && remote.layout).toMatchObject({ type: 'leaf', terminal: { kind: 'ssh', ssh: { connectionId: 'prod', host: 'prod.test', port: 2222 } } });
});
