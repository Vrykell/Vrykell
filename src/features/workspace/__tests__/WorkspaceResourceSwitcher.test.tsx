import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import WorkspaceResourceSwitcher from '../components/WorkspaceResourceSwitcher';
import { leaf } from '../model/windowLayout';
import { workspacePaneIds } from '../model/workspaceResources';
import { compositionTabs, useUnifiedWorkspace } from '../stores/unifiedWorkspace';
import { useWorkspaceNavigation } from '../stores/navigation';
import { useWorkspaceStore } from '../stores/workspace';
import { useAiWorkspace } from '@features/chat/stores/aiWorkspace';
import { useChatStore } from '@features/chat/stores/chat';
import { useHarnessWorkspace } from '@features/chat/stores/harnessWorkspace';

const session = (id: string, title: string) => ({
  id, title, kind: 'session' as const,
  layout: leaf({ id: `${id}#0`, kind: 'local' as const, shellType: 'bash' as const }),
});

function openSwitcher() {
  fireEvent.click(screen.getByTestId('workspace-resource-switcher'));
  return screen.getByRole('menu', { name: '全部工作区标签' });
}

beforeEach(() => {
  useWorkspaceStore.setState({ tabs: [session('one', 'First shell'), session('two', 'Second shell')], activeId: 'one' });
  useWorkspaceNavigation.setState({ area: 'terminal' });
  useUnifiedWorkspace.setState({ activeTabId: '', layout: null, focused: '', order: [], startActive: true, startOpen: true });
  useAiWorkspace.setState({ nativeTabs: [], selected: '', order: [] });
  useChatStore.setState({ conversations: [], byTab: {} });
  useHarnessWorkspace.setState({ connections: [] });
});

afterEach(cleanup);

it('navigates to the native pane from a regular workspace', () => {
  render(<WorkspaceResourceSwitcher />);
  fireEvent.click(within(openSwitcher()).getByRole('menuitem', { name: 'Second shell' }));
  expect(useWorkspaceStore.getState().activeId).toBe('two');
  expect(useWorkspaceNavigation.getState().area).toBe('terminal');
  expect(useUnifiedWorkspace.getState().layout).toBeNull();
});

it('focuses the resource in its own composition instead of splitting the current one', () => {
  useUnifiedWorkspace.getState().reconcile(['terminal:one#0', 'terminal:two#0']);
  useUnifiedWorkspace.setState({ zoomed: useUnifiedWorkspace.getState().focused });
  render(<WorkspaceResourceSwitcher destination="unified" />);
  fireEvent.click(within(openSwitcher()).getByRole('menuitem', { name: 'First shell' }));

  expect(workspacePaneIds(useUnifiedWorkspace.getState().layout!)).toEqual(['terminal:one#0']);
  expect(useUnifiedWorkspace.getState().activeTabId).toBe(
    compositionTabs().find(tab => tab.paneLayout && workspacePaneIds(tab.paneLayout).includes('terminal:one#0'))!.id,
  );
  expect(compositionTabs()).toHaveLength(2);
  expect(useWorkspaceStore.getState().activeId).toBe(useUnifiedWorkspace.getState().activeTabId);
  expect(useWorkspaceNavigation.getState().area).toBe('unified');
});

it('creates a new composition tab and switches the workspace to it when the resource is unplaced', () => {
  useUnifiedWorkspace.getState().reconcile(['terminal:one#0', 'terminal:two#0']);
  const second = compositionTabs().find(tab => tab.paneLayout && workspacePaneIds(tab.paneLayout).includes('terminal:two#0'))!;
  useWorkspaceStore.setState({ tabs: useWorkspaceStore.getState().tabs.filter(tab => tab.id !== second.id) });
  useUnifiedWorkspace.getState().reconcile(['terminal:one#0']);
  const before = compositionTabs().length;

  render(<WorkspaceResourceSwitcher destination="unified" />);
  fireEvent.click(within(openSwitcher()).getByRole('menuitem', { name: 'Second shell' }));

  const active = useUnifiedWorkspace.getState();
  expect(compositionTabs()).toHaveLength(before + 1);
  expect(workspacePaneIds(active.layout!)).toEqual(['terminal:two#0']);
  expect(compositionTabs().find(tab => tab.id === active.activeTabId)?.paneLayout).toBe(active.layout);
  expect(useWorkspaceStore.getState().activeId).toBe(active.activeTabId);
  expect(useWorkspaceNavigation.getState().area).toBe('unified');
});

it('focuses an existing placement without duplicating its reference', () => {
  useUnifiedWorkspace.getState().reconcile(['terminal:one#0', 'terminal:two#0']);
  render(<WorkspaceResourceSwitcher destination="unified" />);
  fireEvent.click(within(openSwitcher()).getByRole('menuitem', { name: 'Second shell' }));

  expect(workspacePaneIds(useUnifiedWorkspace.getState().layout!)).toEqual(['terminal:two#0']);
  expect(compositionTabs()).toHaveLength(2);
  expect(useWorkspaceNavigation.getState().area).toBe('unified');
});
