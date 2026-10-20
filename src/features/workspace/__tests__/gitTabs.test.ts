import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(null) }));
import { useSessionStore, serializeSession } from '../index';
import type { GitSelection } from '@core/git';
import { useGitPreferences } from '@config/git';

beforeEach(() => { useSessionStore.setState({ tabs: [], activeId: '', lastClosed: null }); useGitPreferences.setState({ diffMode: 'multiple' }); });
const selection: GitSelection = { target: { cwd: '/repo' }, paneId: 'owner#0', path: 'src/file.ts', scope: 'unstaged' };

it('reorders comparisons while preserving selection and page identity', () => {
  useGitPreferences.setState({ diffMode: 'single' });
  const store = useSessionStore.getState(); const id = store.openGitDiff(selection);
  store.openGitDiff({ ...selection, path: 'second.ts' });
  const page = useSessionStore.getState().tabs[0];
  if (page?.kind !== 'git-diff' || !page.comparisons) throw new Error('Missing comparisons');
  const second = page.comparisons[1]!; store.moveGitComparison(second.id, page.comparisons[0]!.id, false);
  expect(useSessionStore.getState().tabs[0]).toMatchObject({ id, selection: second.selection, comparisons: [second, page.comparisons[0]] });
});

it('opens independent review tabs, reuses the same comparison and restores a closed tab', () => {
  const store = useSessionStore.getState();
  const first = store.openGitDiff(selection);
  const second = store.openGitDiff({ ...selection, scope: 'staged' });
  expect(first).not.toBe(second);
  expect(store.openGitDiff({ ...selection, paneId: 'other#0' })).toBe(first);
  expect(useSessionStore.getState().tabs).toHaveLength(2);
  expect(serializeSession(useSessionStore.getState().tabs[0]!)).toBeNull();
  store.closeTab(first);
  expect(useSessionStore.getState().activeId).toBe(second);
  store.undoCloseTab();
  const restored = useSessionStore.getState();
  expect(restored.tabs).toHaveLength(2);
  expect(restored.tabs.find(tab => tab.id === restored.activeId)).toMatchObject({ kind: 'git-diff', selection });
});

it('separates repositories and SSH targets with matching paths', () => {
  const store = useSessionStore.getState();
  store.openGitDiff(selection);
  store.openGitDiff({ ...selection, target: { cwd: '/other' } });
  store.openGitDiff({ ...selection, target: { cwd: '/repo', connectionId: 'remote' } });
  expect(useSessionStore.getState().tabs).toHaveLength(3);
});

it('groups comparisons in one page and closes or restores only the selected comparison', () => {
  useGitPreferences.setState({ diffMode: 'single' });
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

it('changes modes while retaining comparisons, selection and an active settings page', () => {
  const store = useSessionStore.getState();
  const first = store.openGitDiff(selection);
  const second = store.openGitDiff({ ...selection, scope: 'staged' });
  store.configureGitDiffTabs('single');
  expect(useSessionStore.getState().activeId).toBe(first);
  expect(useSessionStore.getState().tabs[0]).toMatchObject({ selection: { scope: 'staged' } });
  store.openSettingsTab();
  const settingsId = useSessionStore.getState().activeId;
  store.configureGitDiffTabs('multiple');
  expect(useSessionStore.getState().activeId).toBe(settingsId);
  expect(useSessionStore.getState().tabs.map(tab => tab.id)).toEqual([first, second, settingsId]);
  expect(useSessionStore.getState().tabs[0]).not.toHaveProperty('comparisons');
});
