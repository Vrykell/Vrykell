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
import { useWorkbenchStore } from '../stores/workbench';

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
  useUnifiedWorkspace.setState({ activeTabId: '', layout: null, focused: '', startActive: true });
  useAiWorkspace.setState({ nativeTabs: [], selected: '' });
  useChatStore.setState({ conversations: [], byTab: {} });
  useHarnessWorkspace.setState({ connections: [] });
});

afterEach(cleanup);

it('keeps full resource titles accessible through the shared tooltip', () => {
  const title = 'A long conversation title '.repeat(8);
  useWorkspaceStore.setState({ tabs: [session('one', title)], activeId: 'one' });
  render(<WorkspaceResourceSwitcher />);
  const item = within(openSwitcher()).getByRole('menuitem', { name: title.trim() });
  expect(item).toHaveAttribute('data-tip', title);
  expect(item.querySelector('[data-menu-label]')).toHaveStyle({ textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
});

it('navigates to the native pane from a regular workspace', () => {
  render(<WorkspaceResourceSwitcher />);
  fireEvent.click(within(openSwitcher()).getByRole('menuitem', { name: 'Second shell' }));
  expect(useWorkspaceStore.getState().activeId).toBe('two');
  expect(useWorkspaceNavigation.getState().area).toBe('terminal');
  expect(useUnifiedWorkspace.getState().layout).toBeNull();
});

it('selects the owning tab without merging it into the current composition', () => {
  useUnifiedWorkspace.getState().show('terminal:one#0');
  useUnifiedWorkspace.getState().show('terminal:two#0');
  render(<WorkspaceResourceSwitcher destination="unified" />);
  fireEvent.click(within(openSwitcher()).getByRole('menuitem', { name: 'First shell' }));

  expect(workspacePaneIds(useUnifiedWorkspace.getState().layout!)).toEqual(['terminal:one#0']);

  expect(compositionTabs()).toHaveLength(2);
  expect(useWorkbenchStore.getState().snapshot.selected.unified).toBe(useUnifiedWorkspace.getState().activeTabId);
  expect(useWorkspaceStore.getState().activeId).toBe('one');
  expect(useWorkspaceNavigation.getState().area).toBe('unified');
});

it('opens an unplaced resource in its own tab and preserves the current layout', () => {
  useUnifiedWorkspace.getState().show('terminal:one#0');
  useUnifiedWorkspace.getState().show('terminal:two#0');
  useUnifiedWorkspace.getState().reconcile(['terminal:one#0']);
  const before = compositionTabs().length;

  render(<WorkspaceResourceSwitcher destination="unified" />);
  fireEvent.click(within(openSwitcher()).getByRole('menuitem', { name: 'Second shell' }));

  const active = useUnifiedWorkspace.getState();
  expect(compositionTabs()).toHaveLength(before + 1);
  expect(workspacePaneIds(active.layout!)).toEqual(['terminal:two#0']);
  expect(compositionTabs().find(tab => tab.id === active.activeTabId)?.layout).toBe(active.layout);
  expect(useWorkbenchStore.getState().snapshot.selected.unified).toBe(active.activeTabId);
  expect(useWorkspaceStore.getState().activeId).toBe('two');
  expect(useWorkspaceNavigation.getState().area).toBe('unified');
});

it('focuses an existing placement without duplicating its reference', () => {
  useUnifiedWorkspace.getState().show('terminal:one#0');
  useUnifiedWorkspace.getState().show('terminal:two#0');
  render(<WorkspaceResourceSwitcher destination="unified" />);
  fireEvent.click(within(openSwitcher()).getByRole('menuitem', { name: 'Second shell' }));

  expect(workspacePaneIds(useUnifiedWorkspace.getState().layout!)).toEqual(['terminal:two#0']);
  expect(compositionTabs()).toHaveLength(2);
  expect(useWorkspaceNavigation.getState().area).toBe('unified');
});
