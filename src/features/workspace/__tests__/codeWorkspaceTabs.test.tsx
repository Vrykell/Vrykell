import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { editorFileKey, type EditorFile } from '@core/editor';
import type { GitSelection } from '@core/git';
import { useEditorDocuments } from '@features/editor/stores/documents';
import { useSessionStore } from '../model/session/store';
import { useWorkspaceNavigation } from '../stores/navigation';
import { useCodeWorkspaceTabs } from '../hooks/useCodeWorkspaceTabs';
import type { Tab } from '../stores/workspace';

const first: EditorFile = { path: '/repo/one.ts' };
const second: EditorFile = { path: '/repo/two.ts' };
const selection: GitSelection = { target: { cwd: '/repo' }, paneId: 'page', path: 'two.ts', scope: 'unstaged' };
const tabs: Tab[] = [
  { id: 'page', title: 'Editor', kind: 'editor', files: [first, second], selected: first },
  { id: 'review', title: 'Review', kind: 'git-diff', selection, comparisons: [{ id: 'cmp', selection }] },
];
const openEditorFile = vi.fn();
const closeEditorFile = vi.fn();
const activateGitComparison = vi.fn();
const closeGitComparison = vi.fn();
const moveCodeTab = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  useSessionStore.setState({ tabs, activeId: 'page', openEditorFile, closeEditorFile, activateGitComparison, closeGitComparison });
  useEditorDocuments.setState({ documents: {} });
  useWorkspaceNavigation.setState({ codeOrder: [], moveCodeTab });
});

it('exposes ordered handles and routes activation through the owning document', () => {
  const { result } = renderHook(() => useCodeWorkspaceTabs());
  expect(result.current.handles.map(handle => handle.id)).toEqual([
    `file:${editorFileKey(first)}`, `file:${editorFileKey(second)}`, 'diff:cmp',
  ]);
  act(() => result.current.onSelect(`file:${editorFileKey(second)}`));
  expect(openEditorFile).toHaveBeenCalledWith(second);
  act(() => result.current.onSelect('diff:cmp'));
  expect(activateGitComparison).toHaveBeenCalledWith('cmp');
});

it('routes close through the same file and comparison guards', () => {
  const { result } = renderHook(() => useCodeWorkspaceTabs());
  act(() => result.current.onClose(`file:${editorFileKey(first)}`));
  expect(closeEditorFile).toHaveBeenCalledWith(first);
  act(() => result.current.onClose('diff:cmp'));
  expect(closeGitComparison).toHaveBeenCalledWith('cmp');
});

it('moves using the currently projected ids so stale saved ids never leak in', () => {
  useWorkspaceNavigation.setState({ codeOrder: ['stale', 'diff:cmp'] });
  const { result } = renderHook(() => useCodeWorkspaceTabs());
  act(() => result.current.onMove('diff:cmp', `file:${editorFileKey(first)}`, false));
  expect(moveCodeTab).toHaveBeenCalledWith([
    'diff:cmp', `file:${editorFileKey(first)}`, `file:${editorFileKey(second)}`,
  ], 'diff:cmp', `file:${editorFileKey(first)}`, false);
});
