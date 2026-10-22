import { afterEach, beforeEach, expect, it } from 'vitest';
import { normalizeSidebarWidth, orderedWorkspaceIds, useWorkspaceNavigation, workspaceAreaForKind, workspaceSidebarWidth } from '../stores/navigation';
const snapshot = useWorkspaceNavigation.getState();
beforeEach(() => useWorkspaceNavigation.setState({ collapsed: false, sidebarWidth: 208, sidebarDragWidth: null, area: 'terminal', previousArea: 'terminal', lastTabs: {}, groupColors: {}, codeOrder: [], aiPlacement: 'main' }));
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
it('retains width on collapse and reverses a held drag before committing a new width', () => {
  const navigation = useWorkspaceNavigation.getState();
  navigation.resizeSidebar(-49, 400);
  expect(workspaceSidebarWidth()).toBe(0);
  expect(useWorkspaceNavigation.getState().sidebarWidth).toBe(208);
  navigation.resizeSidebar(121, 400);
  expect(workspaceSidebarWidth()).toBe(280);
  navigation.commitSidebarWidth();
  expect(useWorkspaceNavigation.getState().sidebarWidth).toBe(280);
  expect(useWorkspaceNavigation.getState().sidebarDragWidth).toBeNull();
  navigation.resizeSidebar(-200, 400); navigation.commitSidebarWidth();
  navigation.setCollapsed(false);
  expect(workspaceSidebarWidth()).toBe(280);
  expect(JSON.parse(localStorage.getItem('workspace-navigation-v1')!).sidebarWidth).toBe(280);
});
it('bounds expansion, preserves the remembered size across viewport constraints and resets it', () => {
  const navigation = useWorkspaceNavigation.getState();
  navigation.resizeSidebar(1000, 400); navigation.commitSidebarWidth();
  expect(workspaceSidebarWidth()).toBe(400);
  expect(workspaceSidebarWidth(720)).toBe(360);
  expect(workspaceSidebarWidth(900, 726)).toBe(174);
  expect(workspaceSidebarWidth(760, 726)).toBe(0);
  expect(workspaceSidebarWidth(1240)).toBe(400);
  navigation.resetSidebarWidth();
  expect(workspaceSidebarWidth()).toBe(208);
});
it('keeps the exact collapse boundary and rejects invalid resize values', () => {
  const navigation = useWorkspaceNavigation.getState();
  navigation.resizeSidebar(-48, 400);
  expect(workspaceSidebarWidth()).toBe(160);
  navigation.resizeSidebar(Number.NaN, 400); navigation.resizeSidebar(10, Infinity);
  expect(workspaceSidebarWidth()).toBe(160);
  navigation.resizeSidebar(-1, 400);
  expect(workspaceSidebarWidth()).toBe(0);
});
it.each([[null, 208], [Number.NaN, 208], [Infinity, 208], ['300', 208], [159, 160], [800, 400], [240.8, 241]])('normalizes saved sidebar width %s', (value, expected) => {
  expect(normalizeSidebarWidth(value)).toBe(expected);
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
