import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import TerminalLauncher from '../components/TerminalLauncher';
import { useSessionStore } from '../model/session/store';
import { useWorkspaceNavigation } from '../stores/navigation';
import { useSshStore } from '@features/ssh';

vi.mock('@platform/shells', async (original) => ({
  ...(await original<typeof import('@platform/shells')>()),
  getAvailableShells: vi.fn().mockResolvedValue([
    { id: 'zsh', label: 'Zsh', default: true },
    { id: 'bash', label: 'Bash', default: false },
  ]),
}));

const workspace = useSessionStore.getState();
const ssh = useSshStore.getState();
const navigation = useWorkspaceNavigation.getState();
beforeEach(() => {
  useSessionStore.setState({ tabs: [], activeId: '' });
  useWorkspaceNavigation.setState({ area: 'terminal' });
  useSshStore.setState({
    loaded: true,
    connections: [{ id: 'prod', name: 'Production', host: 'prod.test', user: 'root', port: 2222, authMethod: 'password' }],
  });
});
afterEach(() => {
  cleanup();
  useSessionStore.setState(workspace, true);
  useSshStore.setState(ssh, true);
  useWorkspaceNavigation.setState(navigation, true);
});

it('starts a terminal and opens the shared picker for profile selection', async () => {
  render(<TerminalLauncher />);
  expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('启动终端');
  expect(screen.getByRole('button', { name: '连接服务器' })).toBeVisible();
  expect(screen.queryByText('Bash')).toBeNull();
  fireEvent.click(screen.getByTestId('terminal-start-new'));
  expect(useSessionStore.getState().tabs.find((tab) => tab.kind === 'session')?.layout).toMatchObject({
    type: 'leaf',
    terminal: { kind: 'local' },
  });
  fireEvent.click(screen.getByTestId('terminal-start-picker'));
  expect(screen.getByRole('dialog', { name: '新建标签页' })).toBeVisible();
  expect(await screen.findByTestId('new-tab-option-ssh:prod')).toBeVisible();
  fireEvent.click(await screen.findByTestId('new-tab-option-shell:bash'));
  const tabs = useSessionStore.getState().tabs;
  expect(tabs[tabs.length - 1]).toMatchObject({ layout: { terminal: { shellType: 'bash' } } });
});

it('closes the profile picker when leaving the terminal workspace', () => {
  render(<TerminalLauncher />);
  fireEvent.click(screen.getByTestId('terminal-start-picker'));
  expect(screen.getByRole('dialog', { name: '新建标签页' })).toBeVisible();
  act(() => useWorkspaceNavigation.setState({ area: 'code' }));
  act(() => useWorkspaceNavigation.setState({ area: 'terminal' }));
  expect(screen.queryByRole('dialog', { name: '新建标签页' })).toBeNull();
});
