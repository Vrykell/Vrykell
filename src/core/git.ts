export interface GitTarget {
  cwd: string;
  connectionId?: string;
}

export interface GitEntry {
  path: string;
  previousPath: string | null;
  indexStatus: string;
  worktreeStatus: string;
}

export interface GitSnapshot {
  root: string;
  branch: string;
  entries: GitEntry[];
  upstream?: string | null;
  ahead?: number;
  behind?: number;
  remotes?: string[];
  detached?: boolean;
  hasHead?: boolean;
  operation?: 'merge' | 'rebase' | null;
}

export type GitOperation = 'stageAll' | 'unstageAll' | 'commit' | 'fetch' | 'pull' | 'push' | 'sync';
export type GitFileAction = 'stage' | 'unstage' | 'discard' | 'resolve';

export type GitScope = 'unstaged' | 'staged' | 'untracked' | 'conflicts';

export interface GitDiff {
  original: string;
  modified: string;
  kind: 'text' | 'binary' | 'tooLarge';
}

export interface GitSelection {
  target: GitTarget;
  paneId: string;
  path: string;
  scope: GitScope;
}

export interface GitComparison { id: string; selection: GitSelection }
export const gitComparisonKey = (selection: GitSelection) => JSON.stringify([selection.target.connectionId ?? '', selection.target.cwd, selection.path, selection.scope]);
export interface GitWorktree {
  path: string;
  head: string;
  branch: string | null;
  detached: boolean;
  bare: boolean;
  locked: string | null;
  prunable: string | null;
}

export interface GitReference { name: string; shortName: string; hash: string; kind: 'branch' | 'remote' | 'tag' }
export type GitReferenceAction = 'switchBranch' | 'createBranch' | 'renameBranch' | 'deleteBranch' | 'merge' | 'rebase' | 'abortMerge' | 'abortRebase' | 'continueRebase' | 'createTag' | 'deleteTag';
