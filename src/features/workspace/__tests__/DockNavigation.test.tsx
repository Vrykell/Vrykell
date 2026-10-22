import { afterEach, beforeEach, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useDockStore, useUiStore, useNavigationDrag } from '@features/workspace';
import DockNavigation from '../components/DockNavigation';
import NavigationDragPreview from '../components/NavigationDragPreview';
import { useAuxiliarySidebarStore } from '../stores/auxiliarySidebar';

beforeEach(() => {
  useUiStore.setState({ settingsOpen: false });
  useNavigationDrag.getState().end();
  useAuxiliarySidebarStore.setState({ sshStatusOwner: null, dismissRequest: 0 });
  useDockStore.setState({ leftZone: [], rightZone: ['files', 'git', 'chat'], leftPanels: [], rightPanels: [], collapsedPanels: [], panelWidths: {} });
});
afterEach(() => { cleanup(); act(() => useNavigationDrag.getState().end()); });

it('renders auxiliary controls together with shared icon geometry', () => {
  render(<DockNavigation side="right" />);
  for (const button of screen.getAllByRole('button')) {
    expect(button).toHaveClass('activity-button', 'icon-button');
    expect(button.querySelector('svg')).toHaveAttribute('width', '24');
    expect(button).toHaveAttribute('draggable', 'false');
  }
  expect(screen.queryByRole('button', { name: '设置' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '资源' }));
  expect(useDockStore.getState().rightPanels).toEqual(['files']);
});
it('exits settings through an auxiliary action without changing the workspace', () => {
  useUiStore.setState({ settingsOpen: true });
  render(<DockNavigation side="right" />);
  fireEvent.click(screen.getByRole('button', { name: '资源' }));
  expect(useUiStore.getState().settingsOpen).toBe(false);
  expect(useDockStore.getState().rightPanels).toEqual(['files']);
});
it('dismisses the status sidebar when selecting the assistant', () => {
  useDockStore.setState({ rightPanels: ['chat'] });
  render(<DockNavigation side="right" />);
  act(() => useAuxiliarySidebarStore.getState().showSshStatus('ssh-pane'));
  const ai = screen.getByRole('button', { name: 'AI 助手' });
  expect(ai).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(ai);
  expect(useAuxiliarySidebarStore.getState().sshStatusOwner).toBeNull();
  expect(ai).toHaveAttribute('aria-pressed', 'true');
});
it('reserves an insertion slot without saving until a drag completes', () => {
  render(<><DockNavigation side="right" /><NavigationDragPreview /></>);
  const saved = localStorage.getItem('dock-layout-v6');
  act(() => { useNavigationDrag.getState().start('files', { x: 500, y: 24 }); useNavigationDrag.getState().hover('right', 2); });
  const placeholder = document.querySelector('[data-dock-placeholder="2"]')!;
  expect(placeholder.nextElementSibling).toHaveAttribute('data-dock-slot', 'chat');
  expect(document.querySelector('.workspace-navigation-drag-preview')).toHaveStyle({ left: '500px', top: '24px' });
  expect(localStorage.getItem('dock-layout-v6')).toBe(saved);
  act(() => useNavigationDrag.getState().end());
  expect(document.querySelector('[data-dock-placeholder]')).toBeNull();
});
it('does not render an auxiliary navigation on the left', () => {
  const { container } = render(<DockNavigation side="left" />);
  expect(container).toBeEmptyDOMElement();
});

it('opens the remembered left panel without dismissing right-side host status', () => {
  useDockStore.setState({ leftZone: ['files'], rightZone: ['chat'] });
  render(<DockNavigation side="left" />);
  act(() => useAuxiliarySidebarStore.getState().showSshStatus('ssh-pane'));
  fireEvent.click(screen.getByRole('button', { name: '资源' }));
  expect(useDockStore.getState().leftPanels).toEqual(['files']);
  expect(useAuxiliarySidebarStore.getState().sshStatusOwner).toBe('ssh-pane');
});
