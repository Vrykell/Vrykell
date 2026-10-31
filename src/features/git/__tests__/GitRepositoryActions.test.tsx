import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import GitRepositoryActions from '../components/GitRepositoryActions';
import { runGitOperation } from '../services/operations';
import { useGitOperations } from '../stores/operations';

vi.mock('../services/operations', () => ({ runGitOperation: vi.fn(), preferredGitRemote: () => 'origin' }));
vi.mock('@features/workspace', () => ({ useSessionStore: { getState: () => ({}) } }));
const target = { cwd: '/repo' };
beforeEach(() => { vi.resetAllMocks(); useGitOperations.setState({ drafts: {}, busy: {}, errors: {} }); });

it('exposes remote operations only after opening the shared more menu', async () => {
  render(<GitRepositoryActions target={target} snapshot={{ root: '/repo', branch: 'main', entries: [], remotes: ['origin'], behind: 2 }} refresh={() => {}} />);
  expect(screen.queryByRole('button', { name: '获取' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '更多版本控制操作' }));
  fireEvent.click(screen.getByRole('button', { name: '拉取（2 个传入提交）' }));
  await waitFor(() => expect(runGitOperation).toHaveBeenCalledWith(target, 'pull', expect.objectContaining({ remote: 'origin' })));
  expect(screen.queryByRole('button', { name: '获取' })).toBeNull();
});

it('exposes terminal binding as a checked submenu even without a repository snapshot', () => {
  const select = vi.fn();
  render(<GitRepositoryActions target={target} snapshot={null} refresh={() => {}}
    terminalMenu={{ value: null, options: [{ id: 'pane-b', label: 'Server', live: true }], onSelect: select }} />);

  fireEvent.click(screen.getByRole('button', { name: '更多版本控制操作' }));
  const bind = screen.getByRole('menuitem', { name: '绑定终端' });
  fireEvent.pointerEnter(bind);
  const submenu = screen.getByRole('menu', { name: '绑定终端' });
  expect(within(submenu).getByRole('menuitemradio', { name: '跟随聚焦终端' })).toHaveAttribute('aria-checked', 'true');
  fireEvent.click(within(submenu).getByRole('menuitemradio', { name: 'Server' }));
  expect(select).toHaveBeenCalledWith('pane-b');
});

it('chooses a remote through a submenu when several are configured', async () => {
  render(<GitRepositoryActions target={target} snapshot={{ root: '/repo', branch: 'main', entries: [], remotes: ['origin', 'upstream'] }} refresh={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: '更多版本控制操作' }));
  fireEvent.click(screen.getByRole('menuitem', { name: '推送' }));
  fireEvent.click(screen.getByRole('button', { name: 'upstream' }));
  await waitFor(() => expect(runGitOperation).toHaveBeenCalledWith(target, 'push', expect.objectContaining({ remote: 'upstream' })));
});
