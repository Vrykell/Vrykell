import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

it('chooses a remote through a submenu when several are configured', async () => {
  render(<GitRepositoryActions target={target} snapshot={{ root: '/repo', branch: 'main', entries: [], remotes: ['origin', 'upstream'] }} refresh={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: '更多版本控制操作' }));
  fireEvent.click(screen.getByRole('menuitem', { name: '推送' }));
  fireEvent.click(screen.getByRole('button', { name: 'upstream' }));
  await waitFor(() => expect(runGitOperation).toHaveBeenCalledWith(target, 'push', expect.objectContaining({ remote: 'upstream' })));
});
