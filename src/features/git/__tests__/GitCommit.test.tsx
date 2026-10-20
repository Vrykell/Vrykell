import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import GitCommit from '../components/GitCommit';
import { gitTargetKey, useGitOperations } from '../stores/operations';
import { generateCommitMessage } from '../services/commitMessage';
import { operateGit } from '@platform/api/git';
import type { GitSnapshot } from '@core/git';

vi.mock('@platform/api/git', () => ({ operateGit: vi.fn() }));
vi.mock('../services/commitMessage', () => ({ generateCommitMessage: vi.fn() }));
vi.mock('@features/workspace', () => ({ useSessionStore: { getState: () => ({}) } }));
const target = { cwd: '/repo' };
const key = gitTargetKey(target);
const snapshot: GitSnapshot = { root: '/repo', branch: 'main', remotes: ['origin'], entries: [{ path: 'file.ts', previousPath: null, indexStatus: 'M', worktreeStatus: 'M' }] };
beforeEach(() => { vi.resetAllMocks(); useGitOperations.setState({ drafts: {}, errors: {}, busy: {} }); });

it('retains manual typing made while a message is being generated', async () => {
  let resolve: (value: string) => void = () => {};
  vi.mocked(generateCommitMessage).mockImplementation(() => new Promise(done => { resolve = done; }));
  render(<GitCommit target={target} snapshot={snapshot} refresh={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: '生成提交信息' }));
  fireEvent.change(screen.getByRole('textbox', { name: '提交信息' }), { target: { value: 'fix: typed during generation' } });
  await act(async () => resolve('feat: generated'));
  expect(screen.getByRole('textbox', { name: '提交信息' })).toHaveValue('fix: typed during generation');
  expect(operateGit).not.toHaveBeenCalled();
});

it('keeps a failed commit draft and exposes the error details', async () => {
  useGitOperations.getState().draft(key, 'fix: keep draft');
  vi.mocked(operateGit).mockRejectedValue(new Error('Permission denied'));
  render(<GitCommit target={target} snapshot={snapshot} refresh={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: '提交' }));
  await waitFor(() => expect(screen.getByText('版本库操作失败')).toBeVisible());
  fireEvent.click(screen.getByRole('button', { name: '技术详情' }));
  expect(screen.getByText('Error: Permission denied')).toBeVisible();
  expect(screen.getByRole('textbox', { name: '提交信息' })).toHaveValue('fix: keep draft');
});

it('commits then pushes through the action menu and clears only the committed draft', async () => {
  useGitOperations.getState().draft(key, 'feat: review');
  vi.mocked(operateGit).mockResolvedValue(undefined);
  render(<GitCommit target={target} snapshot={snapshot} refresh={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: '提交操作' }));
  fireEvent.click(screen.getByRole('button', { name: '提交并推送' }));
  await waitFor(() => expect(operateGit).toHaveBeenCalledTimes(2));
  expect(vi.mocked(operateGit).mock.calls.map(call => call[1])).toEqual(['commit', 'push']);
  expect(screen.getByRole('textbox', { name: '提交信息' })).toHaveValue('');
});

it('changes the primary button to synchronization when the working tree becomes clean', async () => {
  vi.mocked(operateGit).mockResolvedValue(undefined);
  const clean = { ...snapshot, entries: [], upstream: 'origin/main', ahead: 2, behind: 1 };
  const { rerender } = render(<GitCommit target={target} snapshot={clean} refresh={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: '同步更改 ↓1 ↑2' }));
  await waitFor(() => expect(operateGit).toHaveBeenCalledWith(target, 'sync', expect.objectContaining({ remote: 'origin' })));
  rerender(<GitCommit target={target} snapshot={{ ...clean, ahead: 0, behind: 0 }} refresh={() => {}} />);
  await waitFor(() => expect(screen.getByRole('button', { name: '已是最新' })).toBeDisabled());
});

it('publishes a clean branch without an upstream and avoids a staging hint on clean repositories', () => {
  render(<GitCommit target={target} snapshot={{ ...snapshot, entries: [], hasHead: true }} refresh={() => {}} />);
  expect(screen.getByRole('button', { name: '发布分支' })).toBeEnabled();
  expect(screen.queryByText('暂存变更后即可提交。')).toBeNull();
});

it('keeps synchronization busy until the operation finishes and restores the button after failure', async () => {
  let reject: (reason: Error) => void = () => {};
  vi.mocked(operateGit).mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
  render(<GitCommit target={target} snapshot={{ ...snapshot, entries: [], upstream: 'origin/main', ahead: 1 }} refresh={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: '同步更改 ↑1' }));
  const syncing = screen.getByRole('button', { name: '正在同步… ↑1' });
  expect(syncing).toHaveAttribute('aria-busy', 'true');
  expect(syncing).toBeDisabled();
  await act(async () => reject(new Error('Network unavailable')));
  const retry = await screen.findByRole('button', { name: '同步更改 ↑1' });
  expect(retry).toHaveAttribute('aria-busy', 'false');
  expect(retry).toBeEnabled();
  expect(screen.getByText('版本库操作失败')).toBeVisible();
});

it('keeps feedback for a complete turn when synchronization finishes immediately', async () => {
  vi.useFakeTimers();
  try {
    vi.mocked(operateGit).mockResolvedValue(undefined);
    const clean = { ...snapshot, entries: [], upstream: 'origin/main', ahead: 1 };
    const { rerender } = render(<GitCommit target={target} snapshot={clean} refresh={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: '同步更改 ↑1' }));
    await act(async () => {});
    rerender(<GitCommit target={target} snapshot={{ ...clean, ahead: 0 }} refresh={() => {}} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(799); });
    expect(screen.getByRole('button', { name: '正在同步…' })).toHaveAttribute('aria-busy', 'true');
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(screen.getByRole('button', { name: '已是最新' })).toHaveAttribute('aria-busy', 'false');
  } finally { vi.useRealTimers(); }
});
