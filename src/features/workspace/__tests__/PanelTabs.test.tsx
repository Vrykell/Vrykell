import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import PanelTabs from '../components/PanelTabs';
import { useSessionStore } from '../model/session/store';
import { useListReorder } from '@ui/listReorder';
import { useIconColorStore } from '@config/iconColors';

vi.mock('@features/agent/services/title', () => ({ regenerateTitle: vi.fn() }));
vi.mock('../components/NewTabModal', () => ({
  default: ({ open, groupId }: { open: boolean; groupId?: string }) =>
    <div data-testid="new-tab-modal" data-open={String(open)} data-group={groupId ?? ''} />,
}));
const snapshot = useSessionStore.getState();
beforeEach(() => {
  useIconColorStore.setState({ colors: {} });
  useSessionStore.setState({
    tabs: [
      { id: 'local', title: 'Shell', kind: 'session', layout: { type: 'leaf', terminal: { id: 'local#0', kind: 'local', shellType: 'bash' } } },
      { id: 'settings', title: 'Settings', kind: 'settings' },
      { id: 'history', title: 'History', kind: 'history' },
    ], activeId: 'settings', groups: [], loadGroups: vi.fn().mockResolvedValue(undefined),
  });
});

it.each(['local', 'settings', 'history'])('colors the %s icon from its context menu without activating the tab', id => {
  render(<PanelTabs />);
  const row = screen.getByTestId(`tab-row-${id}`);
  fireEvent.contextMenu(row);
  const palette = screen.getByRole('group', { name: '图标颜色' });
  fireEvent.click(palette.querySelector('[data-color="violet"]')!);
  expect(row.querySelector('svg')!.style.color).toBe('var(--group-violet)');
  expect(useSessionStore.getState().activeId).toBe('settings');
  fireEvent.contextMenu(row);
  fireEvent.click(screen.getByTestId('tab-icon-color-auto'));
  if (id === 'local') expect(row.querySelector('svg')!.style.color).toBe('var(--shell-bash-accent)');
  else expect(row.querySelector('svg')!.style.color).toBe(id === 'settings' ? 'var(--group-blue)' : 'var(--group-amber)');
});
afterEach(() => { cleanup(); useListReorder.getState().end(); useSessionStore.setState(snapshot, true); });

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

  // The group's own + keeps the new tab inside that group.
  fireEvent.click(screen.getByRole('button', { name: '在此分组新建终端' }));
  expect(screen.getByTestId('new-tab-modal')).toHaveAttribute('data-group', 'group-a');
});

it('lists singleton pages alongside sessions and switches or closes them', () => {
  render(<PanelTabs />);
  const settings = screen.getByTestId('tab-row-settings');
  const history = screen.getByTestId('tab-row-history');
  expect(settings).toHaveAttribute('data-reorder-item', 'settings');
  expect(history).toHaveAttribute('data-reorder-kind', 'loose-tab');
  fireEvent.click(history);
  expect(useSessionStore.getState().activeId).toBe('history');
  fireEvent.doubleClick(settings);
  expect(settings.querySelector('input')).toBeNull();
  fireEvent.contextMenu(settings);
  expect(screen.queryByText('复制会话')).toBeNull();
  fireEvent.click(screen.getByText('关闭标签'));
  expect(useSessionStore.getState().tabs.some(tab => tab.kind === 'settings')).toBe(false);
});

it('filters singleton pages without hiding other rows', () => {
  const { container } = render(<PanelTabs />);
  const icon = screen.getByTestId('tab-row-local').querySelector('svg')!;
  expect(icon).toHaveAttribute('data-shell-mark', 'bash');
  expect(screen.getByTestId('tab-row-settings')).toBeVisible();
  expect(screen.getByTestId('tab-row-history')).toBeVisible();
  act(() => useSessionStore.getState().activate('local'));
  expect(icon.style.color).toBe('var(--shell-bash-accent)');
  fireEvent.change(screen.getByTestId('tab-search'), { target: { value: 'History' } });
  expect(screen.getByTestId('tab-row-history')).toBeVisible();
  expect(screen.queryByTestId('tab-row-settings')).toBeNull();
  expect(container.querySelectorAll('[data-tab-row-id]')).toHaveLength(1);
});

it('keeps group rows intact through renaming and reordering', () => {
  useSessionStore.setState({ groups: [
    { id: 'group-a', title: 'First', collapsed: false },
    { id: 'group-b', title: 'Second', collapsed: false },
  ] });
  render(<PanelTabs />);
  const firstIcon = screen.getByTestId('group-header-group-a').querySelector('[data-group-icon]')!;
  expect(firstIcon).toHaveStyle({ width: '24px', height: '24px', color: 'var(--group-amber)' });
  expect(firstIcon).toHaveAttribute('data-group-icon', 'open');
  act(() => useSessionStore.setState({ groups: [
    { id: 'group-b', title: 'Second', collapsed: false },
    { id: 'group-a', title: 'Renamed', collapsed: false },
  ] }));
  expect(screen.getByTestId('group-header-group-a')).toHaveTextContent('Renamed');
});

it('colors groups from a keyboard-accessible menu and inherits color until a member overrides it', () => {
  useSessionStore.setState(state => ({
    tabs: state.tabs.map(tab => tab.kind === 'session' ? { ...tab, groupId: 'group-a' } : tab),
    groups: [{ id: 'group-a', title: 'Group', collapsed: false }],
  }));
  render(<PanelTabs />);
  const header = screen.getByTestId('group-header-group-a');
  const member = screen.getByTestId('tab-row-local');
  fireEvent.keyDown(header, { key: 'F10', shiftKey: true });
  fireEvent.click(screen.getByRole('menuitemradio', { name: '紫色' }));
  expect(header.querySelector('[data-group-icon]')).toHaveStyle({ color: 'var(--group-violet)' });
  expect(member.querySelector('svg')!.style.color).toBe('var(--group-violet)');
  expect(useSessionStore.getState().groups[0].collapsed).toBe(false);
  expect(header).toHaveFocus();
  fireEvent.contextMenu(member);
  fireEvent.click(screen.getByRole('menuitemradio', { name: '青色' }));
  expect(member.querySelector('svg')!.style.color).toBe('var(--group-cyan)');
  fireEvent.contextMenu(header);
  fireEvent.click(screen.getByRole('menuitemradio', { name: '绿色' }));
  expect(member.querySelector('svg')!.style.color).toBe('var(--group-cyan)');
  fireEvent.contextMenu(member);
  fireEvent.click(screen.getByTestId('tab-icon-color-auto'));
  expect(member.querySelector('svg')!.style.color).toBe('var(--group-green)');
});

it('keeps a filtered nonempty group protected by the archive confirmation', () => {
  const archiveGroup = vi.fn();
  const deleteGroup = vi.fn();
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  useSessionStore.setState(state => ({
    tabs: state.tabs.map(tab => tab.kind === 'session' ? { ...tab, groupId: 'group-a' } : tab),
    groups: [{ id: 'group-a', title: 'Group', collapsed: false }], archiveGroup, deleteGroup,
  }));
  render(<PanelTabs />);
  fireEvent.change(screen.getByTestId('tab-search'), { target: { value: 'History' } });
  fireEvent.contextMenu(screen.getByTestId('group-header-group-a'));
  fireEvent.click(screen.getByText('归档分组'));
  expect(confirm).toHaveBeenCalledOnce();
  expect(deleteGroup).not.toHaveBeenCalled();
  expect(archiveGroup).not.toHaveBeenCalled();
  confirm.mockRestore();
});

it('keeps an empty session drop zone expandable and previews grouped tabs outside singleton rows', () => {
  const moveTab = vi.fn();
  useSessionStore.setState(state => ({
    tabs: state.tabs.map(tab => tab.kind === 'session' ? { ...tab, groupId: 'group-a' } : tab),
    groups: [{ id: 'group-a', title: 'Group', collapsed: false }], moveTab,
  }));
  const { container } = render(<PanelTabs />);
  const zone = container.querySelector<HTMLElement>('[data-reorder-zone="ungrouped"]')!;
  expect(zone.style.flex).toBe('1 0 auto');
  expect(zone.style.minHeight).toBe('44px');
  expect(zone.closest<HTMLElement>('[data-reorder-list]')!.style.display).toBe('flex');
  expect(zone.querySelectorAll('[data-reorder-item]')).toHaveLength(2);
  act(() => {
    useListReorder.getState().start({ listId: 'session-tabs', id: 'local', kind: 'tab' }, { x: 10, y: 500 });
    useListReorder.getState().hover({ itemId: 'history', after: true });
  });
  expect(zone.querySelector('[data-reorder-placeholder="history"]')).not.toBeNull();
  expect(screen.getByTestId('group-header-group-a').parentElement!.querySelector('[data-reorder-placeholder]')).toBeNull();
  expect(moveTab).not.toHaveBeenCalled();
});
