import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { getGitWorktrees } from '@platform/api/git';
import GitWorktrees from '../components/GitWorktrees';

vi.mock('@platform/api/git', () => ({ getGitWorktrees: vi.fn() }));
beforeEach(() => vi.resetAllMocks());
it('shows worktree states and permits selection only for available checkouts', async () => {
  const select = vi.fn();
  const base = { head: 'abc', detached: false, bare: false, locked: null, prunable: null };
  vi.mocked(getGitWorktrees).mockResolvedValue([
    { ...base, path: '/repo', branch: 'main' },
    { ...base, path: '/linked', branch: 'feature', locked: 'in use' },
    { ...base, path: '/missing', branch: 'gone', prunable: 'missing directory' },
    { ...base, path: '/bare', branch: null, bare: true },
  ]);
  render(<GitWorktrees target={{ cwd: '/repo' }} revision={0} onSelect={select} />);
  await screen.findByText('feature');
  expect(screen.getByText('已锁定')).toBeVisible();
  fireEvent.click(screen.getByText('gone'));
  fireEvent.click(screen.getByText('裸仓库'));
  expect(select).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('feature'));
  expect(select).toHaveBeenCalledWith('/linked');
});
it('offers a retry after a listing failure', async () => {
  vi.mocked(getGitWorktrees).mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValueOnce([]);
  render(<GitWorktrees target={{ cwd: '/repo' }} revision={0} onSelect={() => {}} />);
  await screen.findByText('无法加载工作树');
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  await waitFor(() => expect(screen.getByText('没有工作树')).toBeVisible());
});
