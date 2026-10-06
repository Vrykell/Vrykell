import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useDockStore } from '../stores/dock';
import DockNavigation from '../components/DockNavigation';
import { useSessionStore, useNavigationDrag, leaf } from '@features/workspace';

beforeEach(() => {
  useNavigationDrag.getState().end();
  useSessionStore.setState({ activeId: 'session', tabs: [{ id: 'session', title: '终端', kind: 'session', layout: leaf({ id: 'terminal', kind: 'local' }) }] });
  useDockStore.setState({
  leftZone: ['tabs', 'ssh', 'files'], rightZone: ['chat', 'settings'],
  leftPanels: ['tabs'], rightPanels: [], collapsedPanels: [], panelWidths: {},
  });
});
afterEach(() => act(() => useNavigationDrag.getState().end()));

describe('shared navigation buttons', () => {
  it('renders the AI action with the same icon-only control as the other actions', () => {
    render(<><DockNavigation side="left" /><DockNavigation side="right" /></>);
    for (const button of screen.getAllByRole('button')) {
      expect(button).toHaveClass('activity-button');
      expect(button).toHaveStyle({ width: '32px', height: '32px' });
      expect(button.textContent).toBe('');
      expect(button.querySelector('svg')).toHaveAttribute('width', '24');
      expect(button).toHaveAttribute('draggable', 'false');
    }
    const ai = screen.getByRole('button', { name: 'AI 助手' });
    expect(ai).toHaveAttribute('title', expect.stringContaining('打开右侧面板'));
    fireEvent.click(ai);
    expect(ai).toHaveAttribute('aria-pressed', 'true');
    expect(ai).toHaveAttribute('title', expect.stringContaining('关闭右侧面板'));
    expect(useDockStore.getState().rightPanels).toEqual(['chat']);
  });
  it('opens the settings page from its moved action without replacing a sidebar', () => {
    useDockStore.getState().moveButton('settings', 'left', 0);
    render(<><DockNavigation side="left" /><DockNavigation side="right" /></>);
    const settings = screen.getByRole('button', { name: '设置' });
    expect(settings.closest('[data-dock-zone]')).toHaveAttribute('data-dock-zone', 'left');
    fireEvent.click(settings);
    expect(settings).toHaveAttribute('aria-pressed', 'true');
    expect(useSessionStore.getState().tabs.filter(tab => tab.kind === 'settings')).toHaveLength(1);
    fireEvent.click(settings);
    expect(useSessionStore.getState().tabs.filter(tab => tab.kind === 'settings')).toHaveLength(1);
    expect(useDockStore.getState().leftPanels).toEqual(['tabs']);
    expect(useDockStore.getState().rightPanels).toEqual([]);
  });
  it('reserves a full insertion slot and restores the original layout on cancellation', () => {
    render(<><DockNavigation side="left" /><DockNavigation side="right" /></>);
    const saved = localStorage.getItem('dock-layout-v4');
    act(() => {
      useNavigationDrag.getState().start('files', { x: 500, y: 24 });
      useNavigationDrag.getState().hover('right', 0);
    });
    const placeholder = document.querySelector('[data-dock-placeholder="0"]')!;
    expect(placeholder.nextElementSibling).toHaveAttribute('data-dock-slot', 'chat');
    expect(document.querySelector('[data-dock-slot="files"]')).toHaveAttribute('data-moving', 'true');
    expect(document.querySelector('.workspace-navigation-drag-preview')).toHaveStyle({ left: '500px', top: '24px' });
    expect(useDockStore.getState().leftZone).toEqual(['tabs', 'ssh', 'files']);
    expect(localStorage.getItem('dock-layout-v4')).toBe(saved);
    act(() => useNavigationDrag.getState().end());
    expect(document.querySelector('[data-dock-placeholder]')).toBeNull();
    expect(document.querySelector('.workspace-navigation-drag-preview')).toBeNull();
    expect(document.querySelector('[data-dock-slot="files"]')).toHaveAttribute('data-moving', 'false');
  });
});
