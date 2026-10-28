import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import PanelTabs from '../components/PanelTabs';
import { useSessionStore } from '../model/session/store';
import { useListReorder } from '@ui/layout/listReorder';
import { useTerminalDefaults } from '@config/terminalDefaults';
import { getAvailableShells } from '@platform/shells';
import { useWorkspaceNavigation } from '../stores/navigation';
import { groupRename } from '@platform/api/group';
import { useWorkbenchStore } from '../stores/workbench';

vi.mock('@platform/api/group', async original => ({ ...await original<typeof import('@platform/api/group')>(), groupRename: vi.fn().mockResolvedValue(undefined) }));

vi.mock('@platform/shells', async original => ({ ...await original<typeof import('@platform/shells')>(), getAvailableShells: vi.fn().mockResolvedValue([
  { id: 'zsh', label: 'Zsh', default: true }, { id: 'bash', label: 'Bash', default: false },
]) }));

vi.mock('@features/agent/services/title', () => ({ regenerateTitle: vi.fn() }));
vi.mock('../components/NewTabModal', () => ({
  default: ({ open, groupId }: { open: boolean; groupId?: string }) =>
    <div data-testid="new-tab-modal" data-open={String(open)} data-group={groupId ?? ''} />,
}));
const snapshot = useSessionStore.getState();
beforeEach(() => {
  useTerminalDefaults.setState({ shell: 'system' });
  useWorkspaceNavigation.setState({ groupColors: {} });
  useSessionStore.setState({
    tabs: [
      { id: 'local', title: 'Shell', kind: 'session', layout: { type: 'leaf', terminal: { id: 'local#0', kind: 'local', shellType: 'bash' } } },
      { id: 'ai-history', title: 'Conversations', kind: 'ai-history' },
      { id: 'history', title: 'History', kind: 'history' },
    ], activeId: 'ai-history', groups: [], loadGroups: vi.fn().mockResolvedValue(undefined),
  });
});

it('colors a restored unspecified shell from the machine default and preserves explicit shell colors', async () => {
  useSessionStore.setState({ tabs: [
    { id: 'restored', title: 'Terminal', kind: 'session', layout: { type: 'leaf', terminal: { id: 'restored#0', kind: 'local' } } },
    ...useSessionStore.getState().tabs,
  ] });
  render(<PanelTabs />);
  await screen.findByTestId('tab-row-restored');
  const { waitFor } = await import('@testing-library/react');
  await waitFor(() => expect(screen.getByTestId('tab-row-restored').querySelector('svg')).toHaveAttribute('data-shell-mark', 'zsh'));
  expect(screen.getByTestId('tab-row-restored').querySelector('svg')!.style.color).toBe('var(--shell-zsh-accent)');
  act(() => useTerminalDefaults.getState().setShell('bash'));
  expect(screen.getByTestId('tab-row-restored').querySelector('svg')).toHaveAttribute('data-shell-mark', 'bash');
  expect(screen.getByTestId('tab-row-local').querySelector('svg')).toHaveAttribute('data-shell-mark', 'bash');
  expect(getAvailableShells).toHaveBeenCalled();
  const spec = useSessionStore.getState().tabs[0];
  expect(spec?.kind === 'session' && spec.layout.type === 'leaf' && spec.layout.terminal.shellType).toBeUndefined();
});

it('uses shell identity and removes terminal icon color controls', () => {
  const id = 'local';
  render(<PanelTabs />);
  const row = screen.getByTestId(`tab-row-${id}`);
  fireEvent.contextMenu(row);
  expect(screen.queryByRole('group', { name: '图标颜色' })).toBeNull();
  expect(screen.queryByRole('menuitem', { name: '图标颜色' })).toBeNull();
  expect(row.querySelector('svg')).toHaveAttribute('data-shell-mark', 'bash');
  expect(useSessionStore.getState().activeId).toBe('ai-history');
});

it('routes container menu actions to their terminal owner and keeps the container selected', () => {
  const previous = useWorkbenchStore.getState();
  const duplicateTab = vi.fn();
  useSessionStore.setState({ activeId: 'local', duplicateTab });
  useWorkbenchStore.setState({ ready: true, snapshot: { version: 2, groups: [], order: {},
    tabs: [{ id: 'layout-local', scope: 'terminal', focused: 'local-pane', layout: { type: 'pane', id: 'local-pane', resourceId: 'terminal:local#0' } }],
    selected: { terminal: 'layout-local' },
  } });
  try {
    render(<PanelTabs />);
    const row = screen.getByTestId('tab-row-layout-local');
    expect(within(row).getByRole('tab')).toHaveAttribute('aria-selected', 'true');
    fireEvent.contextMenu(row);
    fireEvent.click(screen.getByRole('button', { name: '复制会话' }));
    expect(duplicateTab).toHaveBeenCalledExactlyOnceWith('local');
  } finally {
    cleanup();
    useWorkbenchStore.setState(previous, true);
  }
});

afterEach(() => { cleanup(); useListReorder.getState().end(); useSessionStore.setState(snapshot, true); });

it('keeps the start page canvas surface in its drag preview', () => {
  useSessionStore.setState({ tabs: [{ id: 'start', kind: 'start', title: 'Start' }], activeId: 'start' });
  render(<PanelTabs />);
  act(() => useListReorder.getState().start({ listId: 'session-tabs', id: 'start', kind: 'page' }, { x: 100, y: 50 }));
  const preview = document.querySelector('[data-reorder-preview="item"] .folder-tab');
  expect(preview).toHaveAttribute('data-tab-surface', 'canvas');
  expect(preview).toHaveAttribute('data-active', 'true');
  expect(preview?.querySelector('[data-shell-mark="terminal"]')).not.toBeNull();
  expect(screen.getByTestId('tab-row-start').querySelector('[data-shell-mark="terminal"]')).not.toBeNull();
});

it('leaves the tab list empty instead of showing an unmatched-search message when all tabs close', () => {
  useSessionStore.setState({ tabs: [], activeId: '' });
  const { container } = render(<PanelTabs />);
  expect(container.querySelector('[data-tab-row-id]')).toBeNull();
  expect(screen.queryByText('无匹配会话')).toBeNull();
});

it('creates ungrouped tabs from the panel button and keeps only the group button scoped', () => {
  useSessionStore.setState({
    tabs: [
      { id: 'grouped', title: 'Grouped', kind: 'session', groupId: 'group-a', layout: { type: 'leaf', terminal: { id: 'grouped#0', kind: 'local', shellType: 'bash' } } },
    ],
    activeId: 'grouped',
    groups: [{ id: 'group-a', title: 'Group', collapsed: false }],
  });
  render(<PanelTabs />);

  // Even with a grouped tab active, the panel button opens an ungrouped pick.
  fireEvent.click(screen.getByTestId('tab-new-btn'));
  expect(screen.getByTestId('new-tab-modal')).toHaveAttribute('data-open', 'true');
  expect(screen.getByTestId('new-tab-modal')).toHaveAttribute('data-group', '');

  fireEvent.contextMenu(screen.getByTestId('group-header-group-a'));
  fireEvent.click(screen.getByText('在此分组新建终端'));
  expect(screen.getByTestId('new-tab-modal')).toHaveAttribute('data-group', 'group-a');
});

it('creates the default local terminal immediately and keeps the picker on the separate arrow', () => {
  useTerminalDefaults.setState({ shell: 'bash' });
  render(<PanelTabs />);
  fireEvent.click(screen.getByTestId('tab-new-default'));
  const tabs = useSessionStore.getState().tabs;
  const tab = tabs[tabs.length - 1];
  expect(tab?.kind).toBe('session');
  if (tab?.kind !== 'session' || tab.layout.type !== 'leaf') throw new Error('Expected a terminal');
  expect(tab.layout.terminal).toMatchObject({ kind: 'local', shellType: 'bash' });
  expect(tab.groupId).toBeUndefined();
  expect(screen.getByTestId('new-tab-modal')).toHaveAttribute('data-open', 'false');
  fireEvent.click(screen.getByTestId('tab-new-btn'));
  expect(screen.getByTestId('new-tab-modal')).toHaveAttribute('data-open', 'true');
});

it('exposes terminal actions through the leading menu and styles the search as a shared field', async () => {
  render(<PanelTabs />);
  fireEvent.click(screen.getByRole('button', { name: '更多终端操作' }));
  const menu = screen.getByRole('menu', { name: '更多终端操作' });
  expect(menu).toHaveTextContent('新建终端选项');
  await act(async () => { fireEvent.click(within(menu).getByRole('menuitem', { name: '搜索会话…' })); });
  expect(screen.getByTestId('tab-search')).toHaveClass('text-input-field');
});

it('shows the terminal history singleton in the strip but never the AI pages', () => {
  render(<PanelTabs />);
  expect(screen.queryByTestId('tab-row-ai-history')).toBeNull();
  expect(screen.queryByTestId('tab-row-usage')).toBeNull();
  expect(screen.getByTestId('tab-row-history')).toHaveAttribute('data-tab-surface', 'canvas');
  fireEvent.click(screen.getByTestId('tab-history-btn'));
  expect(useSessionStore.getState().activeId).toBe('history');
  expect(useWorkspaceNavigation.getState()).toMatchObject({ area: 'terminal' });
});

it('prevents pointer activation from moving focus onto a nested tab button', () => {
  render(<PanelTabs />);
  const row = screen.getByTestId('tab-row-local');
  expect(fireEvent.pointerDown(row.querySelector('[role="tab"]')!, { button: 0, isPrimary: true })).toBe(false);
  expect(useSessionStore.getState().activeId).toBe('local');
  expect(fireEvent.pointerDown(screen.getByTestId('tab-close-local'), { button: 0, isPrimary: true })).toBe(true);
});

it('filters singleton pages without hiding other rows', () => {
  const { container } = render(<PanelTabs />);
  const icon = screen.getByTestId('tab-row-local').querySelector('svg')!;
  expect(icon).toHaveAttribute('data-shell-mark', 'bash');
  expect(screen.queryByTestId('tab-row-ai-history')).toBeNull();
  expect(screen.getByTestId('tab-row-history')).toBeVisible();
  act(() => useSessionStore.getState().activate('local'));
  expect(icon.style.color).toBe('var(--group-green)');
  fireEvent.click(screen.getByTestId('tab-search-toggle'));
  fireEvent.change(screen.getByTestId('tab-search'), { target: { value: 'History' } });
  // The system history page matches by title like any other row; AI pages never appear here.
  expect(screen.getByTestId('tab-row-history')).toBeVisible();
  expect(screen.queryByTestId('tab-row-ai-history')).toBeNull();
  expect(container.querySelectorAll('[data-tab-row-id]')).toHaveLength(1);
});

it('keeps group rows intact through renaming and reordering', () => {
  useSessionStore.setState({ groups: [
    { id: 'group-a', title: 'First', collapsed: false },
    { id: 'group-b', title: 'Second', collapsed: false },
  ] });
  render(<PanelTabs />);
  expect(screen.getByTestId('group-title-group-a')).toHaveTextContent('First');
  expect(screen.getByTestId('group-header-group-a')).toHaveAttribute('aria-expanded', 'true');
  act(() => useSessionStore.setState({ groups: [
    { id: 'group-b', title: 'Second', collapsed: false },
    { id: 'group-a', title: 'Renamed', collapsed: false },
  ] }));
  expect(screen.getByTestId('group-header-group-a')).toHaveTextContent('Renamed');
});

it('renames groups in a styled menu input, commits on dismissal and cancels on Escape', async () => {
  const renameGroup = vi.mocked(groupRename); renameGroup.mockClear();
  useSessionStore.setState({ groups: [{ id: 'work', title: 'Work', collapsed: false }] });
  render(<PanelTabs />);
  const header = screen.getByTestId('group-header-work');
  expect(header).toHaveClass('folder-tab');
  expect(header.parentElement?.parentElement).toHaveAttribute('data-group-card', 'true');
  fireEvent.doubleClick(header);
  expect(header.querySelector('input')).toBeNull();
  expect(screen.queryByRole('textbox', { name: '分组名称' })).toBeNull();
  fireEvent.contextMenu(header);
  const input = screen.getByRole('textbox', { name: '分组名称' });
  expect(input).toHaveClass('text-input-field');
  expect(input).toHaveFocus();
  fireEvent.change(input, { target: { value: 'Cancelled' } });
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(renameGroup).not.toHaveBeenCalled();
  fireEvent.contextMenu(header);
  fireEvent.change(screen.getByRole('textbox', { name: '分组名称' }), { target: { value: 'Production' } });
  await act(async () => { fireEvent.keyDown(screen.getByRole('textbox', { name: '分组名称' }), { key: 'Enter' }); });
  expect(renameGroup).toHaveBeenCalledExactlyOnceWith('work', 'Production');
  fireEvent.contextMenu(header);
  fireEvent.change(screen.getByRole('textbox', { name: '分组名称' }), { target: { value: 'On blur' } });
  await act(async () => { fireEvent.pointerDown(document.body); });
  expect(renameGroup).toHaveBeenLastCalledWith('work', 'On blur');
});

it('keeps group actions and color controls keyboard-accessible without changing member icons', () => {
  useSessionStore.setState(state => ({
    tabs: state.tabs.map(tab => tab.kind === 'session' ? { ...tab, groupId: 'group-a' } : tab),
    groups: [{ id: 'group-a', title: 'Group', collapsed: false }],
  }));
  render(<PanelTabs />);
  const header = screen.getByTestId('group-header-group-a');
  const member = screen.getByTestId('tab-row-local');
  fireEvent.keyDown(header, { key: 'F10', shiftKey: true });
  const palette = screen.getByRole('group', { name: '分组颜色' });
  expect(palette.closest('.context-menu-footer')).not.toBeNull();
  fireEvent.click(screen.getByRole('menuitemradio', { name: '紫色' }));
  expect(useWorkspaceNavigation.getState().groupColors['group-a']).toBe('violet');
  expect(member.querySelector('svg')).toHaveAttribute('data-shell-mark', 'bash');
  expect(useSessionStore.getState().groups[0].collapsed).toBe(false);
  expect(header).toHaveFocus();
  fireEvent.contextMenu(member);
  expect(screen.queryByRole('group', { name: '图标颜色' })).toBeNull();
  expect(member.querySelector('svg')).toHaveAttribute('data-shell-mark', 'bash');
});

it('keeps a filtered nonempty group protected by the archive confirmation', () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  useSessionStore.setState(state => ({
    tabs: state.tabs.map(tab => tab.kind === 'session' ? { ...tab, groupId: 'group-a' } : tab),
    groups: [{ id: 'group-a', title: 'Group', collapsed: false }],
  }));
  render(<PanelTabs />);
  fireEvent.click(screen.getByTestId('tab-search-toggle'));
  fireEvent.change(screen.getByTestId('tab-search'), { target: { value: 'History' } });
  fireEvent.contextMenu(screen.getByTestId('group-header-group-a'));
  fireEvent.click(screen.getByText('归档分组'));
  expect(confirm).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog', { name: '归档分组' })).toBeVisible();
  fireEvent.click(screen.getByTestId('confirm-cancel'));
  expect(useSessionStore.getState().groups).toHaveLength(1);
  confirm.mockRestore();
});

it('opens the panel menu on a blank-area right click even while the native menu is cancelled globally', () => {
  // The webview policy cancels every native context menu in the capture phase, so a
  // handler must not gate on `defaultPrevented` (it is already true when React runs).
  // Menu ownership travels through stopPropagation instead.
  const cancelNativeMenu = (event: Event) => event.preventDefault();
  window.addEventListener('contextmenu', cancelNativeMenu, true);
  try {
    const { container } = render(<PanelTabs />);
    fireEvent.contextMenu(container.querySelector<HTMLElement>('[data-reorder-list="session-tabs"]')!);
    // The blank-area menu is the panel one, so no row action is offered.
    expect(screen.getByText('AI 自动分组')).toBeVisible();
    expect(screen.queryByText('关闭标签')).toBeNull();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText('AI 自动分组')).toBeNull();

    // A row keeps its own menu: it stops propagation, so no second panel menu appears.
    fireEvent.contextMenu(screen.getByTestId('tab-row-local'));
    expect(screen.getByText('关闭标签')).toBeVisible();
    expect(screen.getAllByRole('menu')).toHaveLength(1);
  } finally {
    window.removeEventListener('contextmenu', cancelNativeMenu, true);
  }
});

it('keeps an empty session drop zone expandable and previews grouped tabs outside singleton rows', () => {
  const moveTab = vi.fn();
  useSessionStore.setState(state => ({
    tabs: state.tabs.map(tab => tab.kind === 'session' ? { ...tab, groupId: 'group-a' } : tab),
    groups: [{ id: 'group-a', title: 'Group', collapsed: false }], moveTab,
  }));
  const { container } = render(<PanelTabs />);
  const zone = container.querySelector<HTMLElement>('[data-reorder-zone="ungrouped"]')!;
  expect(zone).toHaveClass('terminal-ungrouped-tail');
  expect(zone.closest('[data-reorder-list]')).toHaveClass('terminal-tab-list');
  expect(zone.closest('[data-reorder-list]')!.querySelectorAll('[data-reorder-item]')).toHaveLength(3);
  act(() => {
    useListReorder.getState().start({ listId: 'session-tabs', id: 'local', kind: 'tab' }, { x: 10, y: 500 });
    useListReorder.getState().hover({ zoneId: 'ungrouped' });
  });
  expect(zone.querySelector('[data-reorder-placeholder="ungrouped"]')).not.toBeNull();
  expect(screen.getByTestId('group-header-group-a').parentElement!.querySelector('[data-reorder-placeholder]')).toBeNull();
  expect(moveTab).not.toHaveBeenCalled();
});

it('gives a collapsed group the tab surface only while it owns the active tab, is hovered or dragged', () => {
  useSessionStore.setState(state => ({
    tabs: state.tabs.map(tab => tab.kind === 'session' ? { ...tab, groupId: 'group-a' } : tab),
    activeId: 'ai-history',
    groups: [{ id: 'group-a', title: 'Group', collapsed: true }],
  }));
  render(<PanelTabs />);
  const header = screen.getByTestId('group-header-group-a');
  const group = header.closest('.terminal-tab-group')!;
  expect(group).toHaveAttribute('data-group-collapsed', 'true');
  expect(header).not.toHaveAttribute('data-tab-surface');
  fireEvent.mouseEnter(group);
  expect(header).toHaveAttribute('data-tab-surface', 'true');
  fireEvent.mouseLeave(group);
  expect(header).not.toHaveAttribute('data-tab-surface');
  act(() => useSessionStore.setState({ activeId: 'local' }));
  expect(header).toHaveAttribute('data-tab-surface', 'true');
  act(() => useListReorder.getState().start({ listId: 'session-tabs', id: 'group-a', kind: 'group' }, { x: 10, y: 10 }));
  expect(document.querySelector('.terminal-group-preview .tab-group-header')).toHaveAttribute('data-tab-surface', 'true');
  act(() => useListReorder.getState().end());
  expect(header).toHaveAttribute('data-tab-surface', 'true');
});

it('treats expanded groups as inactive cards and only folds them visually while dragged', () => {
  useSessionStore.setState(state => ({
    tabs: state.tabs.map(tab => tab.kind === 'session' ? { ...tab, groupId: 'group-a' } : tab),
    activeId: 'local',
    groups: [{ id: 'group-a', title: 'Group', collapsed: false }],
  }));
  render(<PanelTabs />);
  const group = screen.getByTestId('group-header-group-a').closest('.terminal-tab-group')!;
  expect(group.querySelector('[data-group-active]')).toBeNull();
  expect(screen.getByTestId('group-header-group-a')).not.toHaveAttribute('data-header-selected');
  expect(screen.getByTestId('tab-row-local')).toBeVisible();
  act(() => useListReorder.getState().start({ listId: 'session-tabs', id: 'group-a', kind: 'group' }, { x: 10, y: 10 }));
  expect(screen.queryByTestId('tab-row-local')).toBeNull();
  expect(screen.queryByTestId('group-count-group-a')).toBeNull();
  act(() => useListReorder.getState().end());
  expect(screen.getByTestId('tab-row-local')).toBeVisible();
  expect(useSessionStore.getState().groups[0]!.collapsed).toBe(false);
});
