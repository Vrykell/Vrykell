import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import WorkspaceSidebar from '../components/WorkspaceSidebar';
import { useWorkspaceNavigation } from '../stores/navigation';

const navigation = useWorkspaceNavigation.getState();
const width = window.innerWidth;
afterEach(() => { cleanup(); useWorkspaceNavigation.setState(navigation, true); Object.defineProperty(window, 'innerWidth', { configurable: true, value: width }); });

it('keeps history next to collapse, one footer destination, and no collapsed rail', () => {
  useWorkspaceNavigation.setState({ collapsed: false });
  const { container } = render(<WorkspaceSidebar />);
  expect(screen.getByTestId('workspace-history').nextElementSibling).toBe(screen.getByTestId('workspace-sidebar-toggle'));
  expect(container.querySelectorAll('.workspace-sidebar-footer .sidebar-row')).toHaveLength(1);
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
