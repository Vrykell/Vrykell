import { describe, expect, it } from 'vitest';
import { groupChanges } from '../model/changes';
import type { GitEntry } from '@core/git';

const entry = (path: string, indexStatus: string, worktreeStatus: string): GitEntry => ({ path, indexStatus, worktreeStatus, previousPath: null });

describe('change groups', () => {
  it('shows partially staged files in both comparisons and keeps conflicts separate', () => {
    const groups = groupChanges([
      entry('partial.ts', 'M', 'M'), entry('new.ts', '?', '?'),
      entry('conflict.ts', 'U', 'U'), entry('deleted.ts', ' ', 'D'),
      entry('added.ts', 'A', 'A'),
    ], '');
    expect(groups.conflicts.map(file => file.path)).toEqual(['conflict.ts', 'added.ts']);
    expect(groups.staged.map(file => file.path)).toEqual(['partial.ts']);
    expect(groups.unstaged.map(file => file.path)).toEqual(['partial.ts', 'deleted.ts']);
    expect(groups.untracked.map(file => file.path)).toEqual(['new.ts']);
  });

  it('filters complete paths without interpreting special characters', () => {
    expect(groupChanges([entry('src/[demo].ts', ' ', 'M'), entry('README.md', 'M', ' ')], '[DEMO]').unstaged)
      .toEqual([entry('src/[demo].ts', ' ', 'M')]);
  });
});
