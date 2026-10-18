import type { GitEntry, GitScope } from '@core/git';

export function groupChanges(entries: readonly GitEntry[], query: string): Record<GitScope, GitEntry[]> {
  const groups: Record<GitScope, GitEntry[]> = { conflicts: [], staged: [], unstaged: [], untracked: [] };
  const search = query.trim().toLocaleLowerCase();
  for (const entry of entries) {
    if (search && !`${entry.path}\n${entry.previousPath ?? ''}`.toLocaleLowerCase().includes(search)) continue;
    const status = entry.indexStatus + entry.worktreeStatus;
    if (['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].includes(status)) groups.conflicts.push(entry);
    else if (status === '??') groups.untracked.push(entry);
    else {
      if (entry.indexStatus !== ' ' && entry.indexStatus !== '?') groups.staged.push(entry);
      if (entry.worktreeStatus !== ' ' && entry.worktreeStatus !== '?') groups.unstaged.push(entry);
    }
  }
  return groups;
}
