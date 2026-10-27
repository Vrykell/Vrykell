import { beforeEach, expect, it, vi } from 'vitest';
import { registerEditorCloseGuard } from '@core/editor';
import { useWorkspaceStore } from '../stores/workspace';
import { compositionTabs, detachCompositionPane, mergeCompositionTab, selectCompositionTab, useUnifiedWorkspace } from '../stores/unifiedWorkspace';
import { workspacePaneIds } from '../model/workspaceResources';
import { createUnifiedResource } from '../services/unifiedWorkspace';
import { closeContainer } from '../services/workbench';
import { useAiWorkspace } from '@features/chat/stores/aiWorkspace';
import { useChatStore } from '@features/chat/stores/chat';
import { useWorkspaceNavigation } from '../stores/navigation';
import { useWorkbenchStore } from '../stores/workbench';

vi.mock('@platform/diagnostics', () => ({ invoke: vi.fn(async () => undefined), diagnostic: vi.fn() }));
beforeEach(() => {
  useWorkspaceStore.setState({ tabs: [], activeId: '', lastClosed: null });
  useUnifiedWorkspace.setState({ layout: null, activeTabId: '', focused: '', historyIdentity: undefined });
  useAiWorkspace.setState({ nativeTabs: [], selected: '', sideSelected: '' });
  useChatStore.setState({ conversations: [], byTab: {} });
  useWorkspaceNavigation.setState({ area: 'unified' });
});

it('uses the start page only when no content tab exists, including after closing the last tab', () => {
  useUnifiedWorkspace.getState().reconcile([]);
  expect(compositionTabs()).toHaveLength(1);
  expect(useUnifiedWorkspace.getState().startActive).toBe(true);
  createUnifiedResource('conversation');
  expect(compositionTabs()).toHaveLength(1);
  expect(compositionTabs().every(tab => tab.layout)).toBe(true);
  expect(useUnifiedWorkspace.getState().startActive).toBe(false);
  closeContainer(compositionTabs()[0]!.id);
  expect(compositionTabs()).toHaveLength(1);
  expect(compositionTabs()[0]!.layout).toBeNull();
  expect(useUnifiedWorkspace.getState().startActive).toBe(true);
});

it('adopts existing content without Start and collapses externally emptied tabs to one Start', () => {
  const store = useUnifiedWorkspace.getState();
  store.reconcile(['file:first', 'file:second']);
  expect(compositionTabs()).toHaveLength(2);
  expect(compositionTabs().every(tab => tab.layout)).toBe(true);
  expect(useUnifiedWorkspace.getState().startActive).toBe(false);
  store.reconcile([]);
  expect(compositionTabs()).toHaveLength(1);
  expect(useUnifiedWorkspace.getState().startActive).toBe(true);
});

it('switches complete independent layouts and zooms without discarding sibling resources', () => {
  createUnifiedResource('conversation'); createUnifiedResource('document', 'row');
  const first = compositionTabs()[0]!;
  const original = first.layout;
  useUnifiedWorkspace.getState().single();
  expect(useUnifiedWorkspace.getState().zoomed).toBe(first.focused);
  expect(compositionTabs()[0]!.layout).toBe(original);
  createUnifiedResource('conversation');
  expect(compositionTabs()).toHaveLength(2);
  const second = compositionTabs()[1]!;
  selectCompositionTab(first.id);
  expect(useUnifiedWorkspace.getState().layout).toBe(original);
  expect(useUnifiedWorkspace.getState().zoomed).toBe(first.focused);
  useUnifiedWorkspace.getState().single();
  expect(useUnifiedWorkspace.getState().layout).toBe(original);
  selectCompositionTab(second.id);
  expect(workspacePaneIds(useUnifiedWorkspace.getState().layout!)).toHaveLength(1);
});

it('moves and merges panes through existing tabs without closing their content owners', () => {
  createUnifiedResource('conversation'); createUnifiedResource('document', 'row');
  const owners = useWorkspaceStore.getState().tabs;
  const source = useUnifiedWorkspace.getState().activeTabId;
  const ids = workspacePaneIds(useUnifiedWorkspace.getState().layout!);
  detachCompositionPane(ids[1]!);
  expect(compositionTabs()).toHaveLength(2);
  const detached = useUnifiedWorkspace.getState().activeTabId;
  selectCompositionTab(source);
  mergeCompositionTab(detached, { leafId: 'stale-target', dir: 'row', position: 'second' });
  expect(compositionTabs()).toHaveLength(2);
  mergeCompositionTab(detached, { leafId: useUnifiedWorkspace.getState().focused, dir: 'col', position: 'first' });
  expect(compositionTabs()).toHaveLength(1);
  expect(new Set(workspacePaneIds(useUnifiedWorkspace.getState().layout!))).toEqual(new Set(ids));
  expect(useWorkspaceStore.getState().tabs).toEqual(owners);
});

it('does not close any member until the document close guard completes', () => {
  createUnifiedResource('conversation'); createUnifiedResource('document', 'row');
  const tab = compositionTabs()[0]!;
  let confirm: (() => void) | undefined;
  const unregister = registerEditorCloseGuard((_files, complete) => { confirm = complete; return true; });
  closeContainer(tab.id);
  expect(compositionTabs()[0]).toBe(tab);
  expect(useAiWorkspace.getState().nativeTabs).toHaveLength(1);
  expect(confirm).toBeTypeOf('function');
  confirm!(); unregister();
  expect(useAiWorkspace.getState().nativeTabs).toHaveLength(0);
  expect(useWorkspaceStore.getState().tabs.some(tab => tab.kind === 'editor')).toBe(false);
  expect(useWorkbenchStore.getState().lastClosed).toMatchObject({ scope: 'unified', restoreSnapshot: { members: expect.any(Array) } });
});

it('restores a historical composition into a tab without replacing an unrelated active layout', () => {
  createUnifiedResource('conversation');
  const unrelated = compositionTabs()[0]!;
  useUnifiedWorkspace.getState().restore({ type: 'pane', id: 'saved', resourceId: 'file:saved' }, 'saved', { id: 'workspace:historic', createdAt: 1 });
  expect(compositionTabs()).toHaveLength(2);
  expect(compositionTabs()[0]).toBe(unrelated);
  const restored = useUnifiedWorkspace.getState().activeTabId;
  useUnifiedWorkspace.getState().restore({ type: 'pane', id: 'saved', resourceId: 'file:saved' }, 'saved', { id: 'workspace:historic', createdAt: 1 });
  expect(useUnifiedWorkspace.getState().activeTabId).toBe(restored);
  expect(compositionTabs()).toHaveLength(2);
});
