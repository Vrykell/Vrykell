import type { GitSnapshot } from '@core/git';

export function primaryGitAction(snapshot: GitSnapshot): 'commit' | 'publish' | 'sync' | 'current' | 'clean' {
  if (snapshot.entries.length) return 'commit';
  if (snapshot.detached || snapshot.hasHead === false) return 'clean';
  if (!snapshot.upstream) return snapshot.remotes?.length ? 'publish' : 'clean';
  return snapshot.ahead || snapshot.behind ? 'sync' : 'current';
}
