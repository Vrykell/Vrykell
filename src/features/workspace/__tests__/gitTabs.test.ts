import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(null) }));
import { useSessionStore, serializeSession } from '../index';
import type { GitSelection } from '@core/git';
import { useGitReview } from '@features/git';

beforeEach(() => { useSessionStore.setState({ tabs: [], activeId: '', lastClosed: null }); });
const selection: GitSelection = { target: { cwd: '/repo' }, paneId: 'owner#0', path: 'src/file.ts', scope: 'unstaged' };

it('reorders comparisons while preserving selection and page identity', () => {
  const store = useSessionStore.getState(); const id = store.openGitDiff(selection);
  store.openGitDiff({ ...selection, path: 'second.ts' });
  const page = useSessionStore.getState().tabs[0];
  if (page?.kind !== 'git-diff' || !page.comparisons) throw new Error('Missing comparisons');
  const second = page.comparisons[1]!; store.moveGitComparison(second.id, page.comparisons[0]!.id, false);
  expect(useSessionStore.getState().tabs[0]).toMatchObject({ id, selection: second.selection, comparisons: [second, page.comparisons[0]] });
});

it('opens one review page, reuses the same comparison and restores a closed page', () => {
  const store = useSessionStore.getState();
  const first = store.openGitDiff(selection);
  const second = store.openGitDiff({ ...selection, scope: 'staged' });
  expect(first).toBe(second);
  expect(store.openGitDiff({ ...selection, paneId: 'other#0' })).toBe(first);
  expect(useSessionStore.getState().tabs).toHaveLength(1);
  expect(serializeSession(useSessionStore.getState().tabs[0]!)).toBeNull();
  store.closeTab(first);
  expect(useSessionStore.getState().tabs.map(tab => tab.kind)).toEqual(['start-code']);
  store.undoCloseTab();
  const restored = useSessionStore.getState();
  expect(restored.tabs).toHaveLength(1);
  expect(restored.tabs.find(tab => tab.id === restored.activeId)).toMatchObject({ kind: 'git-diff', selection });
});

it('separates repositories and SSH targets with matching paths', () => {
  const store = useSessionStore.getState();
  store.openGitDiff(selection);
  store.openGitDiff({ ...selection, target: { cwd: '/other' } });
  store.openGitDiff({ ...selection, target: { cwd: '/repo', connectionId: 'remote' } });
  const page = useSessionStore.getState().tabs[0];
  expect(useSessionStore.getState().tabs).toHaveLength(1);
  expect(page?.kind === 'git-diff' && page.comparisons).toHaveLength(3);
});

it('groups comparisons in one page and closes or restores only the selected comparison', () => {
  const store = useSessionStore.getState();
  const pageId = store.openGitDiff(selection);
  expect(store.openGitDiff({ ...selection, scope: 'staged' })).toBe(pageId);
  expect(store.openGitDiff(selection)).toBe(pageId);
  const page = useSessionStore.getState().tabs[0]!;
  expect(page.kind === 'git-diff' && page.comparisons).toHaveLength(2);
  if (page.kind !== 'git-diff') throw new Error('Expected comparison page');
  store.closeGitComparison(page.comparisons![0]!.id);
  expect(useSessionStore.getState().tabs[0]).toMatchObject({ selection: { scope: 'staged' }, comparisons: [expect.anything()] });
  store.undoCloseTab();
  expect(useSessionStore.getState().tabs).toHaveLength(1);
  expect(useSessionStore.getState().tabs[0]).toMatchObject({ selection, comparisons: [expect.anything(), expect.anything()] });
});

it('merges legacy pages while retaining comparisons, selection and an active settings page', () => {
  const store = useSessionStore.getState();
  useSessionStore.setState({ tabs: [
    { id: 'first', title: 'First', kind: 'git-diff', selection },
    { id: 'second', title: 'Second', kind: 'git-diff', selection: { ...selection, scope: 'staged' } },
  ], activeId: 'second' });
  store.configureGitDiffTabs();
  expect(useSessionStore.getState().activeId).toBe('first');
  expect(useSessionStore.getState().tabs[0]).toMatchObject({ selection: { scope: 'staged' } });
  store.openSettings();
  const settingsId = useSessionStore.getState().activeId;
  store.configureGitDiffTabs();
  expect(useSessionStore.getState().activeId).toBe(settingsId);
  expect(useSessionStore.getState().tabs.map(tab => tab.id)).toEqual(['first']);
  expect(useSessionStore.getState().tabs[0]).toMatchObject({ comparisons: [{ id: 'first', selection }, { id: 'second', selection: { ...selection, scope: 'staged' } }] });
});

it('closes the selected comparison after editor pages retarget its pane owner', () => {
  const file = { path: '/repo/file.ts' };
  useSessionStore.setState({ tabs: [
    { id: 'editor-one', title: 'Editor', kind: 'editor', files: [file], selected: file },
    { id: 'editor-two', title: 'Editor', kind: 'editor', files: [{ path: '/repo/other.ts' }], selected: { path: '/repo/other.ts' } },
  ], activeId: 'editor-one' });
  useSessionStore.getState().openGitDiff({ ...selection, paneId: 'editor-one' });
  useSessionStore.getState().openGitDiff({ ...selection, paneId: 'editor-one', scope: 'staged' });
  useSessionStore.getState().configureEditorTabs();

  const page = useSessionStore.getState().tabs.find(tab => tab.kind === 'git-diff');
  expect(page?.kind === 'git-diff' && page.selection.scope).toBe('staged');
  useGitReview.getState().close();

  const remaining = useSessionStore.getState().tabs.find(tab => tab.kind === 'git-diff');
  expect(remaining?.kind === 'git-diff' && remaining.comparisons).toHaveLength(1);
  expect(remaining?.kind === 'git-diff' && remaining.comparisons?.[0]?.selection.scope).toBe('unstaged');
});
