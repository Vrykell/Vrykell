import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from '../stores/workspace';
import { useUnifiedWorkspace } from '../stores/unifiedWorkspace';
import { useWorkbenchStore } from '../stores/workbench';
import { currentWorkspaceResources } from '../services/workspaceResources';
import { useUnifiedWorkspaceTabs } from '../hooks/useUnifiedWorkspaceTabs';
import { workspaceStripEntities } from '../model/workbench';
import { editorFileKey } from '@core/editor';

vi.mock('@platform/diagnostics', () => ({ invoke: vi.fn(async () => undefined), diagnostic: vi.fn() }));
beforeEach(() => { useWorkspaceStore.setState({ tabs: [], activeId: '' }); });

it('projects real layout containers and selects, moves and closes through their common lifecycle', () => {
  const first = { path: '/repo/a.ts' }; const second = { path: '/repo/b.ts' };
  useWorkspaceStore.getState().openEditorFile(first); useWorkspaceStore.getState().openEditorFile(second);
  useUnifiedWorkspace.getState().show(`file:${editorFileKey(first)}`); const one = useUnifiedWorkspace.getState().activeTabId;
  useUnifiedWorkspace.getState().show(`file:${editorFileKey(second)}`); const two = useUnifiedWorkspace.getState().activeTabId;
  const { result } = renderHook(() => useUnifiedWorkspaceTabs(currentWorkspaceResources(), () => null));
  expect(result.current.handles.map(handle => [handle.id, handle.label])).toEqual([[one, 'a.ts'], [two, 'b.ts']]);
  act(() => result.current.onSelect(one));
  expect(useWorkbenchStore.getState().snapshot.selected.unified).toBe(one);
  act(() => result.current.onMove(two, one, false));
  expect(workspaceStripEntities(useWorkbenchStore.getState().snapshot, 'unified')).toEqual([`tab:${two}`, `tab:${one}`]);
  act(() => result.current.onClose(two));
  expect(useWorkbenchStore.getState().snapshot.tabs.some(tab => tab.id === two)).toBe(false);
  expect(useWorkspaceStore.getState().tabs.some(tab => tab.kind === 'editor' && tab.files.some(file => file.path === second.path))).toBe(false);
});

it('leaves the fallback to the start surface when a scope has no content tab', () => {
  useUnifiedWorkspace.getState().openStart();
  const { result } = renderHook(() => useUnifiedWorkspaceTabs([], () => null));
  expect(result.current.handles).toEqual([]);
});
