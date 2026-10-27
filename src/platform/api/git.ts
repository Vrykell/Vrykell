import { diagnostic, invoke as rawInvoke } from '@platform/diagnostics';
import { normPath } from '@platform/path';
import type { GitDiff, GitFileAction, GitOperation, GitScope, GitSnapshot, GitTarget, GitWorktree, GitReference, GitReferenceAction } from '@core/git';

let sequence = 0;
async function track<T>(operation: string, request: () => Promise<T>): Promise<T> {
  const requestId = ++sequence;
  const started = performance.now();
  diagnostic('git-request', { requestId, operation, stage: 'start' });
  try {
    const result = await request();
    diagnostic('git-request', { requestId, operation, stage: 'complete', durationMs: Math.round(performance.now() - started) });
    return result;
  } catch (reason) {
    diagnostic('git-request', { requestId, operation, stage: 'error', durationMs: Math.round(performance.now() - started) }, 'error');
    throw reason;
  }
}

export function getGitSnapshot(target: GitTarget): Promise<GitSnapshot | null> {
  const normalized = target.connectionId ? target : { ...target, cwd: normPath(target.cwd) };
  return track('snapshot', () => rawInvoke<GitSnapshot | null>('git_snapshot', { target: normalized })
    .then(snapshot => snapshot && !target.connectionId ? { ...snapshot, root: normPath(snapshot.root) } : snapshot));
}

export function getGitDiff(target: GitTarget, path: string, scope: GitScope): Promise<GitDiff> {
  return track(`diff:${scope}`, () => rawInvoke('git_diff', { target, path, scope }));
}

export function changeGitFile(target: GitTarget, path: string, action: GitFileAction): Promise<void> {
  return track(action, () => rawInvoke('git_change_file', { target, path, action }));
}

export function getGitBranches(target: GitTarget): Promise<string[]> {
  return track('branches', () => rawInvoke('git_branches', { target }));
}

export function getGitWorktrees(target: GitTarget): Promise<GitWorktree[]> {
  return track('worktrees', () => rawInvoke('git_worktrees', { target }));
}

export function getGitReferences(target: GitTarget): Promise<GitReference[]> {
  return track('references', () => rawInvoke('git_references', { target }));
}
export function editGitReference(target: GitTarget, action: GitReferenceAction, name: string, options: { newName?: string; startPoint?: string; message?: string } = {}): Promise<void> {
  return track(action, () => rawInvoke('git_edit_reference', { target, action, name, newName: options.newName ?? null, startPoint: options.startPoint ?? null, message: options.message ?? null }));
}

export function switchGitBranch(target: GitTarget, branch: string): Promise<void> {
  return track('switchBranch', () => rawInvoke('git_switch_branch', { target, branch }));
}

export function operateGit(target: GitTarget, operation: GitOperation, options: { message?: string; remote?: string } = {}): Promise<void> {
  return track(operation, () => rawInvoke('git_operate', { target, operation, message: options.message ?? null, remote: options.remote ?? null }));
}

export function getGitCommitContext(target: GitTarget): Promise<string> {
  return track('commitContext', () => rawInvoke('git_commit_context', { target }));
}
