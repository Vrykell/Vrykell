import { beforeEach, expect, it } from 'vitest';
import { DEFAULT_COMMIT_PROMPT, gitCommitPrompt, useGitPreferences } from '@config/git';
import { useGitContextStore } from '../stores/context';
import { horizontalWheelDelta } from '@ui/hooks/useHorizontalWheel';

beforeEach(() => { useGitPreferences.setState({ commitPrompts: {}, diffMode: 'single', changesView: 'list' }); useGitContextStore.setState({ recent: null, sourceKey: '' }); });
it('remembers prompts per repository and saved connection and resets to the default', () => {
  const local = { cwd: '/repo' }; const remote = { cwd: '/repo', connectionId: 'ssh' };
  useGitPreferences.getState().setCommitPrompt(local, 'Use concise subjects');
  useGitPreferences.getState().setCommitPrompt(remote, 'Use a detailed body');
  expect(gitCommitPrompt(local)).toBe('Use concise subjects');
  expect(gitCommitPrompt(remote)).toBe('Use a detailed body');
  expect(gitCommitPrompt({ cwd: '/other' })).toBe(DEFAULT_COMMIT_PROMPT);
  useGitPreferences.getState().setCommitPrompt(local, ' ');
  expect(gitCommitPrompt(local)).toBe(DEFAULT_COMMIT_PROMPT);
  expect(JSON.parse(localStorage.getItem('vrykell-git-preferences')!).state.commitPrompts).toHaveProperty('["ssh","/repo"]');
});
it('keeps a chosen worktree until the source terminal or directory changes', () => {
  const store = useGitContextStore.getState();
  store.remember('pane:/repo/sub', { target: { cwd: '/repo/sub' }, paneId: 'pane' });
  store.canonicalize('pane:/repo/sub', '/repo');
  store.select({ target: { cwd: '/other-worktree' }, paneId: 'pane' });
  store.remember('pane:/repo/sub', { target: { cwd: '/repo/sub' }, paneId: 'pane' });
  store.canonicalize('stale-request', '/wrong');
  expect(useGitContextStore.getState().recent?.target.cwd).toBe('/other-worktree');
  store.remember('pane:/new', { target: { cwd: '/new' }, paneId: 'pane' });
  expect(useGitContextStore.getState().recent?.target.cwd).toBe('/new');
});
it('converts vertical wheel units and keeps native horizontal and pinch gestures', () => {
  const event = { ctrlKey: false, deltaX: 0, deltaY: 3, deltaMode: 0 };
  expect(horizontalWheelDelta(event, 400)).toBe(3);
  expect(horizontalWheelDelta({ ...event, deltaMode: 1 }, 400)).toBe(48);
  expect(horizontalWheelDelta({ ...event, deltaMode: 2 }, 400)).toBe(1200);
  expect(horizontalWheelDelta({ ...event, deltaX: 5 }, 400)).toBe(0);
  expect(horizontalWheelDelta({ ...event, ctrlKey: true }, 400)).toBe(0);
});
