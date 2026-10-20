import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(null) }));
import { useSessionStore } from '../index';
import { registerEditorCloseGuard } from '@core/editor';
import { editorFileKey } from '@core/editor';
import type { Tab } from '../stores/workspace';
beforeEach(() => { useSessionStore.setState({ tabs: [], activeId: '', lastClosed: null }); });
const first = { path: '/repo/one.ts' }; const second = { path: '/repo/two.ts' };
it('always opens files in one editor page and reuses existing file tabs', () => {
  const store = useSessionStore.getState(); const page = store.openEditorFile(first);
  expect(store.openEditorFile(second)).toBe(page); expect(store.openEditorFile(first)).toBe(page);
  expect(useSessionStore.getState().tabs[0]).toMatchObject({ selected: first, files: [first, second] });
  expect(useSessionStore.getState().tabs.filter(tab => tab.kind === 'editor')).toHaveLength(1);
});
it('routes file and whole-page close through the shared unsaved guard', () => {
  const store = useSessionStore.getState(); const id = store.openEditorFile(first); store.openEditorFile(second);
  let approve = () => {};
  const unregister = registerEditorCloseGuard((_files, complete) => { approve = complete; return true; });
  try { store.closeEditorFile(first); expect(useSessionStore.getState().tabs[0]).toMatchObject({ files: [first, second] }); approve();
    expect(useSessionStore.getState().tabs[0]).toMatchObject({ files: [second] });
    store.closeTab(id); expect(useSessionStore.getState().tabs).toHaveLength(1); approve(); expect(useSessionStore.getState().tabs).toHaveLength(0);
  } finally { unregister(); }
});
it('reorders files without changing the active document', () => {
  const store = useSessionStore.getState(); store.openEditorFile(first); store.openEditorFile(second);
  store.moveEditorFile(editorFileKey(second), editorFileKey(first), false);
  expect(useSessionStore.getState().tabs[0]).toMatchObject({ files: [second, first], selected: second });
  store.configureEditorTabs();
  expect(useSessionStore.getState().tabs[0]).toMatchObject({ files: [second, first], selected: second });
});

it('merges legacy pages without duplicating files or changing active settings', () => {
  useSessionStore.setState({ tabs: [
    { id: 'one', kind: 'editor', title: 'one.ts', files: [first], selected: first },
    { id: 'two', kind: 'editor', title: 'two.ts', files: [first, second], selected: second },
    { id: 'settings', kind: 'ai-history', title: 'Settings' },
  ], activeId: 'settings' });
  useSessionStore.getState().configureEditorTabs();
  expect(useSessionStore.getState().tabs).toEqual([
    { id: 'one', kind: 'editor', title: '文件编辑器', files: [first, second], selected: first },
    { id: 'settings', kind: 'ai-history', title: 'Settings' },
  ]);
  expect(useSessionStore.getState().activeId).toBe('settings');
});

it('retains the selected file when merging active legacy pages', () => {
  useSessionStore.setState({ tabs: [
    { id: 'one', kind: 'editor', title: 'one.ts', files: [first], selected: first },
    { id: 'two', kind: 'editor', title: 'two.ts', files: [second], selected: second },
  ], activeId: 'two' });
  useSessionStore.getState().configureEditorTabs();
  expect(useSessionStore.getState().activeId).toBe('one');
  expect(useSessionStore.getState().tabs[0]).toMatchObject({ selected: second, files: [first, second] });
});

it('keeps current and restorable comparisons linked to the merged editor', () => {
  const review: Tab = { id: 'review', title: 'Comparison', kind: 'git-diff',
    selection: { target: { cwd: '/repo' }, paneId: 'two', path: second.path, scope: 'unstaged' } };
  useSessionStore.setState({ tabs: [
    { id: 'one', kind: 'editor', title: 'one.ts', files: [first], selected: first },
    { id: 'two', kind: 'editor', title: 'two.ts', files: [second], selected: second },
    { ...review, comparisons: [{ id: 'comparison', selection: review.selection }] },
  ], activeId: 'review', lastClosed: review });
  useSessionStore.getState().configureEditorTabs();
  expect(useSessionStore.getState().activeId).toBe('review');
  expect(useSessionStore.getState().tabs[1]).toMatchObject({ selection: { paneId: 'one' }, comparisons: [{ selection: { paneId: 'one' } }] });
  expect(useSessionStore.getState().lastClosed).toMatchObject({ selection: { paneId: 'one' } });
});
