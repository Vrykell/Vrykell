import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(null) }));
import { useSessionStore } from '../index';
import { useEditorPreferences } from '@config/editor';
import { registerEditorCloseGuard } from '@core/editor';
import { editorFileKey } from '@core/editor';
beforeEach(() => { useSessionStore.setState({ tabs: [], activeId: '', lastClosed: null }); useEditorPreferences.setState({ pageMode: 'single' }); });
const first = { path: '/repo/one.ts' }; const second = { path: '/repo/two.ts' };
it('deduplicates files and preserves selection while changing editor page modes', () => {
  const store = useSessionStore.getState(); const page = store.openEditorFile(first);
  expect(store.openEditorFile(second)).toBe(page); expect(store.openEditorFile(first)).toBe(page);
  expect(useSessionStore.getState().tabs[0]).toMatchObject({ selected: first, files: [first, second] });
  store.openSettingsTab(); const settings = useSessionStore.getState().activeId;
  store.configureEditorTabs('multiple'); expect(useSessionStore.getState().activeId).toBe(settings);
  expect(useSessionStore.getState().tabs.filter(tab => tab.kind === 'editor')).toHaveLength(2);
  store.configureEditorTabs('single'); expect(useSessionStore.getState().tabs[0]).toMatchObject({ files: [first, second] });
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
it('reorders files without changing the active document and retains order across modes', () => {
  const store = useSessionStore.getState(); store.openEditorFile(first); store.openEditorFile(second);
  store.moveEditorFile(editorFileKey(second), editorFileKey(first), false);
  expect(useSessionStore.getState().tabs[0]).toMatchObject({ files: [second, first], selected: second });
  store.configureEditorTabs('multiple'); store.configureEditorTabs('single');
  expect(useSessionStore.getState().tabs[0]).toMatchObject({ files: [second, first], selected: second });
});
