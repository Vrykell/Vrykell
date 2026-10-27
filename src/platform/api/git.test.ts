import { beforeEach, describe, expect, it, vi } from 'vitest';
import { diagnostic, invoke } from '@platform/diagnostics';
import { changeGitFile, getGitDiff, getGitSnapshot, operateGit, getGitCommitContext } from './git';

vi.mock('@platform/diagnostics', () => ({ diagnostic: vi.fn(), invoke: vi.fn() }));
beforeEach(() => vi.resetAllMocks());

describe('repository transport', () => {
  it('normalizes local native prefixes on request and response but leaves remote paths unchanged', async () => {
    vi.mocked(invoke).mockResolvedValue({ root: '\\\\?\\D:\\repo' });
    expect(await getGitSnapshot({ cwd: '\\\\?\\D:\\repo' })).toEqual({ root: 'D:/repo' });
    expect(invoke).toHaveBeenLastCalledWith('git_snapshot', { target: { cwd: 'D:/repo' } });
    vi.mocked(invoke).mockResolvedValue({ root: '/remote/repo' });
    await getGitSnapshot({ cwd: '/remote/repo', connectionId: 'remote' });
    expect(invoke).toHaveBeenLastCalledWith('git_snapshot', { target: { cwd: '/remote/repo', connectionId: 'remote' } });
  });
  it('keeps commit messages and patches out of operation diagnostics', async () => {
    vi.mocked(invoke).mockResolvedValue('private patch');
    await operateGit({ cwd: '/private' }, 'commit', { message: 'private message' });
    await getGitCommitContext({ cwd: '/private' });
    expect(invoke).toHaveBeenCalledWith('git_operate', { target: { cwd: '/private' }, operation: 'commit', message: 'private message', remote: null });
    expect(JSON.stringify(vi.mocked(diagnostic).mock.calls)).not.toContain('private');
  });
  it('routes remote comparisons without recording paths or file contents in diagnostics', async () => {
    vi.mocked(invoke).mockResolvedValue({ original: 'private code', modified: 'new private code', kind: 'text' });
    const target = { cwd: '/private/repository', connectionId: 'remote' };
    await getGitDiff(target, 'private.ts', 'staged');
    expect(invoke).toHaveBeenCalledWith('git_diff', { target, path: 'private.ts', scope: 'staged' });
    const records = JSON.stringify(vi.mocked(diagnostic).mock.calls);
    expect(records).not.toContain('private');
    expect(records).toContain('complete');
  });

  it('reports errors and preserves the rejection for the inline error surface', async () => {
    vi.mocked(invoke).mockRejectedValue(new Error('private failure'));
    await expect(getGitSnapshot({ cwd: '/private' })).rejects.toThrow('private failure');
    expect(JSON.stringify(vi.mocked(diagnostic).mock.calls)).not.toContain('private');
    const calls = vi.mocked(diagnostic).mock.calls;
    expect(calls[calls.length - 1]?.[2]).toBe('error');
  });

  it('stages one explicit file through the backend', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await changeGitFile({ cwd: '/repo' }, '[file].ts', 'stage');
    expect(invoke).toHaveBeenCalledWith('git_change_file', { target: { cwd: '/repo' }, path: '[file].ts', action: 'stage' });
  });
});
