import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import TerminalLauncher from '../components/TerminalLauncher';
import { useSessionStore } from '../model/session/store';
import { useSshStore } from '@features/ssh';
import { useUiStore } from '../stores/ui';

vi.mock('@platform/shells', async original => ({ ...await original<typeof import('@platform/shells')>(), getAvailableShells: vi.fn().mockResolvedValue([
  { id: 'zsh', label: 'Zsh', default: true }, { id: 'bash', label: 'Bash', default: false },
]) }));

const workspace = useSessionStore.getState();
const ssh = useSshStore.getState();
const ui = useUiStore.getState();
beforeEach(() => {
  useSessionStore.setState({ tabs: [], activeId: '' });
  useSshStore.setState({ loaded: true, connections: [{ id: 'prod', name: 'Production', host: 'prod.test', user: 'root', port: 2222, authMethod: 'password' }], touch: vi.fn().mockResolvedValue(undefined) });
});
afterEach(() => {
  cleanup(); useSessionStore.setState(workspace, true); useSshStore.setState(ssh, true); useUiStore.setState(ui, true);
});

it('rests on one simple page instead of listing every profile and host', () => {
  render(<TerminalLauncher />);
  expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('启动终端');
  expect(screen.getByTestId('terminal-start-new')).toHaveTextContent('新终端');
  expect(screen.getByTestId('terminal-start-picker')).toHaveTextContent('选择配置文件');
  // Profile rows and host rows belong to the picker, not the resting page.
  expect(screen.queryByTestId('terminal-start-profile-zsh')).toBeNull();
  expect(screen.queryByTestId('terminal-start-host-prod')).toBeNull();
});

it('starts a terminal and opens the shared picker for profile selection', () => {
  render(<TerminalLauncher />);
  fireEvent.click(screen.getByTestId('terminal-start-new'));
  const local = useSessionStore.getState().tabs.find(tab => tab.kind === 'session');
  expect(local?.layout).toMatchObject({ type: 'leaf', terminal: { kind: 'local' } });
  fireEvent.click(screen.getByTestId('terminal-start-picker'));
  expect(screen.getByRole('dialog', { name: '新建标签页' })).toBeVisible();
});
