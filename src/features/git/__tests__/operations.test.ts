import { beforeEach, expect, it } from 'vitest';
import { gitTargetKey, useGitOperations } from '../stores/operations';

beforeEach(() => useGitOperations.setState({ drafts: {}, busy: {}, errors: {} }));
it('keeps drafts separate by repository and connection and serializes operations per repository', () => {
  const local = gitTargetKey({ cwd: '/repo' });
  const remote = gitTargetKey({ cwd: '/repo', connectionId: 'ssh' });
  const store = useGitOperations.getState();
  store.draft(local, 'feat: local'); store.draft(remote, 'fix: remote');
  expect(store.begin(local, 'commit')).toBe(true);
  expect(store.begin(local, 'push')).toBe(false);
  expect(store.begin(remote, 'fetch')).toBe(true);
  store.finish(local, 'failed');
  expect(useGitOperations.getState().drafts).toMatchObject({ [local]: 'feat: local', [remote]: 'fix: remote' });
  expect(useGitOperations.getState().errors[local]).toBe('failed');
  expect(store.begin(local, 'commit')).toBe(true);
  expect(useGitOperations.getState().errors[local]).toBeUndefined();
});
