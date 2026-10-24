import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import WorkspaceSidebar from '../components/WorkspaceSidebar';
import { useDockStore } from '../stores/dock';
import { useWorkspaceNavigation } from '../stores/navigation';

const navigation = useWorkspaceNavigation.getState();
const dock = useDockStore.getState();
const width = window.innerWidth;
afterEach(() => {
  cleanup();
  useWorkspaceNavigation.setState(navigation, true);
  useDockStore.setState(dock, true);
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
});

it('keeps history next to collapse, one footer destination, and no collapsed rail', () => {
  useWorkspaceNavigation.setState({ collapsed: false });
  const { container } = render(<WorkspaceSidebar />);
  expect(screen.queryByTestId('workspace-resource-switcher')).toBeNull();
  expect(screen.getByTestId('workspace-history').nextElementSibling).toBe(screen.getByTestId('workspace-sidebar-toggle'));
  expect(screen.getByTestId('workspace-history')).not.toHaveAttribute('aria-pressed');
  act(() => useWorkspaceNavigation.getState().setHistoryLoading(true));
  expect(screen.getByTestId('workspace-history')).toHaveAttribute('data-busy', 'true');
  expect(screen.getByTestId('workspace-history').querySelector('.reload-spin')).not.toBeNull();
  expect(container.querySelectorAll('.workspace-sidebar-footer .sidebar-row')).toHaveLength(1);
  expect(screen.getByTestId('workspace-settings')).toHaveAttribute('data-tip', '打开设置');
  expect(screen.getByTestId('workspace-settings')).toHaveAttribute('data-tip-shortcut', 'Control+,');
  expect(screen.getByTestId('workspace-area-terminal').querySelector('.sidebar-row-content')).toHaveStyle({ minHeight: '32px' });
  fireEvent.click(screen.getByTestId('workspace-sidebar-toggle'));
  expect(screen.getByTestId('workspace-sidebar')).toHaveAttribute('inert');
  expect(useWorkspaceNavigation.getState().collapsed).toBe(true);
});

it('collapses on entering a narrow window and preserves a manual expansion within it', () => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1240 });
  useWorkspaceNavigation.setState({ collapsed: false });
  render(<WorkspaceSidebar />);
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 760 });
  act(() => window.dispatchEvent(new Event('resize')));
  expect(useWorkspaceNavigation.getState().collapsed).toBe(true);
  act(() => useWorkspaceNavigation.getState().setCollapsed(false));
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 700 });
  act(() => window.dispatchEvent(new Event('resize')));
  expect(useWorkspaceNavigation.getState().collapsed).toBe(false);
});

it('keeps the left dock as a bare panel slot without a toolbar heading or buttons', () => {
  act(() => useDockStore.setState({ leftZone: ['files'] }));
  render(<WorkspaceSidebar />);
  expect(screen.queryByText('工具栏')).not.toBeInTheDocument();
  expect(screen.getByTestId('workspace-left-dock').querySelector('[data-dock-btn="files"]')).toBeNull();
});

it('reorders workspace rows and renders them in the saved order', () => {
  act(() => useWorkspaceNavigation.getState().moveWorkspaceArea('ssh', 'terminal', false));
  render(<WorkspaceSidebar />);
  const rows = Array.from(document.querySelectorAll('[data-testid^="workspace-area-"]'))
    .map(row => row.getAttribute('data-testid'));
  expect(rows).toEqual(['workspace-area-ssh', 'workspace-area-terminal', 'workspace-area-code', 'workspace-area-ai', 'workspace-area-unified']);
  expect(useWorkspaceNavigation.getState().workspaceOrder).toEqual(['ssh', 'terminal', 'code', 'ai', 'unified']);
});

it('opens the mixed workspace through a full-width sidebar row with keyboard navigation', () => {
  useWorkspaceNavigation.setState({ collapsed: false, area: 'terminal' });
  render(<WorkspaceSidebar />);
  const row = screen.getByRole('button', { name: '聚合工作区' });
  expect(row).toHaveClass('sidebar-row');
  fireEvent.keyDown(row, { key: 'Enter' });
  expect(useWorkspaceNavigation.getState().area).toBe('unified');
  expect(row).toHaveAttribute('aria-current', 'page');
});

it('resizes through the shared separator, keeps a held collapsed drag reversible and supports keyboard reset', async () => {
  useWorkspaceNavigation.setState({ collapsed: false, sidebarWidth: 208, sidebarDragWidth: null });
  render(<WorkspaceSidebar />);
  const handle = screen.getByRole('separator', { name: '调整工作区侧栏宽度' });
  expect(handle).toHaveAttribute('aria-valuenow', '208');
  fireEvent.mouseDown(handle, { clientX: 208 });
  fireEvent.mouseMove(document, { clientX: 150 });
  await act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });
  expect(screen.getByTestId('workspace-sidebar')).toHaveAttribute('inert');
  fireEvent.mouseMove(document, { clientX: 300 });
  await act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });
  expect(screen.getByTestId('workspace-sidebar')).not.toHaveAttribute('inert');
  fireEvent.mouseUp(document);
  expect(useWorkspaceNavigation.getState().sidebarWidth).toBe(300);
  fireEvent.keyDown(handle, { key: 'ArrowLeft' });
  expect(useWorkspaceNavigation.getState().sidebarWidth).toBe(284);
  fireEvent.keyDown(handle, { key: 'Home' });
  expect(useWorkspaceNavigation.getState().sidebarWidth).toBe(208);
});
