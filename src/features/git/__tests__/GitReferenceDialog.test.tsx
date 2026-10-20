import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import GitReferenceDialog from '../components/GitReferenceDialog';
import { getGitReferences, editGitReference } from '@platform/api/git';
import { useGitOperations } from '../stores/operations';
vi.mock('@platform/api/git', () => ({ getGitReferences: vi.fn(), editGitReference: vi.fn() }));
beforeEach(() => {
  vi.resetAllMocks(); useGitOperations.setState({ busy: {}, drafts: {}, errors: {} });
  vi.mocked(getGitReferences).mockResolvedValue([{ name: 'refs/heads/main', shortName: 'main', hash: 'a', kind: 'branch' }, { name: 'refs/heads/feature', shortName: 'feature', hash: 'b', kind: 'branch' }]);
});
const target = { cwd: '/repo' }; const snapshot = { root: '/repo', branch: 'main', entries: [] };
it('requires a branch name before creating from the chosen source', async () => {
  vi.mocked(editGitReference).mockResolvedValue(undefined); const close = vi.fn();
  render(<GitReferenceDialog target={target} snapshot={snapshot} action="createBranch" onClose={close} refresh={() => {}} />);
  const apply = screen.getByRole('button', { name: '创建分支' }); expect(apply).toBeDisabled();
  fireEvent.change(screen.getByRole('textbox', { name: '新名称' }), { target: { value: 'feature/new' } });
  await waitFor(() => expect(apply).toBeEnabled()); fireEvent.click(apply);
  await waitFor(() => expect(editGitReference).toHaveBeenCalledWith(target, 'createBranch', 'feature/new', { startPoint: 'HEAD' }));
  expect(close).toHaveBeenCalledOnce();
});
it('collects a tag name and message through the labelled fields', async () => {
  vi.mocked(editGitReference).mockResolvedValue(undefined); const close = vi.fn();
  render(<GitReferenceDialog target={target} snapshot={snapshot} action="createTag" onClose={close} refresh={() => {}} />);
  const apply = screen.getByRole('button', { name: '创建标签' }); expect(apply).toBeDisabled();
  fireEvent.change(screen.getByRole('textbox', { name: '新名称' }), { target: { value: 'v2.0' } });
  fireEvent.change(screen.getByRole('textbox', { name: '标签说明（可选）' }), { target: { value: 'Release notes' } });
  await waitFor(() => expect(apply).toBeEnabled()); fireEvent.click(apply);
  await waitFor(() => expect(editGitReference).toHaveBeenCalledWith(target, 'createTag', 'v2.0', { startPoint: 'HEAD', message: 'Release notes' }));
  expect(close).toHaveBeenCalledOnce();
});
it('keeps a failed merge open for inspection and refreshes the operation state', async () => {
  const refresh = vi.fn(); const close = vi.fn(); vi.mocked(editGitReference).mockRejectedValue(new Error('Conflict'));
  render(<GitReferenceDialog target={target} snapshot={snapshot} action="merge" onClose={close} refresh={refresh} />);
  const apply = screen.getByRole('button', { name: '合并分支' });
  await waitFor(() => expect(apply).toBeEnabled()); fireEvent.click(apply);
  await screen.findByRole('alert'); expect(refresh).toHaveBeenCalledOnce(); expect(close).not.toHaveBeenCalled();
  expect(editGitReference).toHaveBeenCalledWith(target, 'merge', 'refs/heads/feature', {});
});
