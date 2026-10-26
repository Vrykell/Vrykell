import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from '../stores/workspace';
import { useUnifiedWorkspace } from '../stores/unifiedWorkspace';
import type { WorkspaceResource } from '../model/workspaceResources';
import { useUnifiedWorkspaceTabs } from '../hooks/useUnifiedWorkspaceTabs';
import { activateCompositionTab, closeCompositionTab } from '../services/compositionTabs';

vi.mock('../services/compositionTabs', () => ({ activateCompositionTab: vi.fn(), closeCompositionTab: vi.fn() }));

const resources: WorkspaceResource[] = [
  { id: 'file:a', title: 'a.ts', kind: 'document', file: { path: '/repo/a.ts' } },
];
const move = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  useWorkspaceStore.setState({
    tabs: [
      { id: 'composed', title: 'Composed', kind: 'workspace', focusedPane: 'p1', paneLayout: { type: 'pane', id: 'p1', resourceId: 'file:a' } },
      { id: 'empty', title: 'Start', kind: 'workspace', focusedPane: '', paneLayout: null },
    ],
    activeId: 'composed',
  });
  useUnifiedWorkspace.setState({ move });
});

it('projects composition pages and delegates selection, close and move', () => {
  const { result } = renderHook(() => useUnifiedWorkspaceTabs(resources, () => null));
  expect(result.current.handles.map(handle => [handle.id, handle.label])).toEqual([['composed', 'a.ts'], ['empty', '开始']]);
  act(() => result.current.onSelect('composed'));
  expect(activateCompositionTab).toHaveBeenCalledWith('composed');
  act(() => result.current.onClose('empty'));
  expect(closeCompositionTab).toHaveBeenCalledWith('empty');
  act(() => result.current.onMove('empty', 'composed', true));
  expect(move).toHaveBeenCalledWith(['composed', 'empty'], 'empty', 'composed', true);
});
