import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import GitStatusButton from '../components/GitStatusButton';
import { switchGitBranch } from '@platform/api/git';
import { useGitOperations } from '../stores/operations';

const mock = vi.hoisted(() => ({
  snapshot: { root: '/repo', branch: 'main', entries: [] as unknown[], remotes: ['origin'], upstream: 'origin/main' },
  refresh: vi.fn(), openPanel: vi.fn(), activate: vi.fn(), setFocusedPane: vi.fn(),
}));
vi.mock('@features/workspace', () => {
  const state = { tabs: [{ id: 'owner', terminals: [{ id: 'pane', kind: 'local', cwd: '/repo' }] }], terminalCwds: {}, activate: mock.activate };
  return { useSessionStore: Object.assign((selector: (value: typeof state) => unknown) => selector(state), { getState: () => state }),
    useDockStore: { getState: () => ({ openPanel: mock.openPanel }) }, terminalsOf: (tab: { terminals: unknown[] }) => tab.terminals };
});
vi.mock('@features/terminal', () => ({ useTerminalStore: { getState: () => ({ setFocusedPane: mock.setFocusedPane }) } }));
vi.mock('@platform/api/git', () => ({ getGitBranches: vi.fn().mockResolvedValue(['main', 'feature/review']), switchGitBranch: vi.fn() }));
vi.mock('../hooks/useGitRepository', () => ({ useGitRepository: () => ({ snapshot: mock.snapshot, error: '', refresh: mock.refresh }) }));
beforeEach(() => { vi.clearAllMocks(); mock.snapshot.entries = []; useGitOperations.setState({ drafts: {}, busy: {}, errors: {} }); });

it('opens source control for the exact pane without sending terminal commands', () => {
  render(<GitStatusButton paneId="pane" branch="main" />);
  fireEvent.click(screen.getByRole('button', { name: 'Git 状态：main' }));
  fireEvent.click(screen.getByRole('button', { name: '打开版本控制' }));
  expect(mock.activate).toHaveBeenCalledWith('owner');
  expect(mock.setFocusedPane).toHaveBeenCalledWith('pane');
  expect(mock.openPanel).toHaveBeenCalledWith('git');
});

it('switches an existing branch from the menu and updates the chip', async () => {
  vi.mocked(switchGitBranch).mockResolvedValue(undefined);
  render(<GitStatusButton paneId="pane" branch="main" />);
  fireEvent.click(screen.getByRole('button', { name: 'Git 状态：main' }));
  await waitFor(() => expect(screen.getByRole('menuitem', { name: '切换分支' })).toBeEnabled());
  fireEvent.click(screen.getByRole('menuitem', { name: '切换分支' }));
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'feature/review' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Git 状态：feature/review' })).toBeVisible());
  expect(switchGitBranch).toHaveBeenCalledWith({ cwd: '/repo', connectionId: undefined }, 'feature/review');
});
