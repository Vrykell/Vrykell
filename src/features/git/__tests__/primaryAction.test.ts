import { expect, it } from 'vitest';
import { primaryGitAction } from '../model/primaryAction';
import type { GitSnapshot } from '@core/git';

const clean: GitSnapshot = { root: '/repo', branch: 'main', entries: [], remotes: ['origin'], upstream: 'origin/main', ahead: 0, behind: 0 };
it('chooses commit, publish and synchronization from the current repository state', () => {
  expect(primaryGitAction(clean)).toBe('current');
  expect(primaryGitAction({ ...clean, ahead: 1 })).toBe('sync');
  expect(primaryGitAction({ ...clean, behind: 2 })).toBe('sync');
  expect(primaryGitAction({ ...clean, upstream: null })).toBe('publish');
  expect(primaryGitAction({ ...clean, upstream: null, remotes: [] })).toBe('clean');
  expect(primaryGitAction({ ...clean, hasHead: false })).toBe('clean');
  expect(primaryGitAction({ ...clean, detached: true })).toBe('clean');
  expect(primaryGitAction({ ...clean, ahead: 2, entries: [{ path: 'new.ts', previousPath: null, indexStatus: '?', worktreeStatus: '?' }] })).toBe('commit');
});
