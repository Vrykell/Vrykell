import { afterEach, beforeEach, expect, it } from 'vitest';
import { orderedWorkspaceIds, useWorkspaceNavigation, workspaceAreaForKind, workspaceSidebarWidth } from '../stores/navigation';
const snapshot = useWorkspaceNavigation.getState();
beforeEach(() => useWorkspaceNavigation.setState({ collapsed: false, area: 'terminal', previousArea: 'terminal', lastTabs: {}, groupColors: {}, codeOrder: [], aiPlacement: 'main' }));
afterEach(() => useWorkspaceNavigation.setState(snapshot, true));

it.each([['session', 'terminal'], ['history', 'terminal'], ['editor', 'code'], ['git-diff', 'code'], ['harness', 'ai'], ['usage', 'ai'], ['ai-history', 'ai']])('assigns %s to the %s workspace', (kind, area) => {
  expect(workspaceAreaForKind(kind)).toBe(area);
});
it('retains the last instance in each area and the return area for side docking', () => {
  useWorkspaceNavigation.getState().rememberTab('terminal', 'terminal-a');
  useWorkspaceNavigation.getState().selectArea('code');
  useWorkspaceNavigation.getState().rememberTab('code', 'editor-a');
  useWorkspaceNavigation.getState().selectArea('ai');
  useWorkspaceNavigation.getState().selectArea('ai');
  expect(useWorkspaceNavigation.getState().previousArea).toBe('code');
  expect(useWorkspaceNavigation.getState().lastTabs).toEqual({ terminal: 'terminal-a', code: 'editor-a' });
});
it('removes all sidebar space when collapsed and permits expansion at any width', () => {
  expect(workspaceSidebarWidth(760)).toBe(208);
  expect(workspaceSidebarWidth(1240)).toBe(208);
  useWorkspaceNavigation.getState().setCollapsed(true);
  expect(workspaceSidebarWidth(1240)).toBe(0);
  expect(JSON.parse(localStorage.getItem('workspace-navigation-v1')!).collapsed).toBe(true);
});
it('interleaves files and comparisons while ignoring stale saved identifiers', () => {
  const ids = ['file:a', 'file:b', 'diff:c'];
  useWorkspaceNavigation.getState().moveCodeTab(ids, 'diff:c', 'file:a', false);
  expect(orderedWorkspaceIds(ids, useWorkspaceNavigation.getState().codeOrder)).toEqual(['diff:c', 'file:a', 'file:b']);
  expect(orderedWorkspaceIds(['file:b', 'file:d'], useWorkspaceNavigation.getState().codeOrder)).toEqual(['file:b', 'file:d']);
});
it('persists group color overrides independently of terminal icon colors', () => {
  useWorkspaceNavigation.getState().setGroupColor('group-a', 'violet');
  expect(JSON.parse(localStorage.getItem('workspace-navigation-v1')!).groupColors).toEqual({ 'group-a': 'violet' });
  useWorkspaceNavigation.getState().setGroupColor('group-a', null);
  expect(useWorkspaceNavigation.getState().groupColors).toEqual({});
});
