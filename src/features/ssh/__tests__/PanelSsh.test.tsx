import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import PanelSsh from '../components/PanelSsh';
import { useSshStore } from '../stores/store';
import { useHostLibrary } from '../stores/hostLibrary';

const snapshot = useSshStore.getState();
beforeEach(() => {
  localStorage.setItem('vrykell-ssh-workspace-view', 'manage');
  useSshStore.setState({
    loaded: true,
    connections: [{ id: 'remote', name: 'Remote', host: 'example.invalid', user: 'tester', authMethod: 'key' }],
  });
});

it('keeps connection actions in the keyboard menu without icon color controls', () => {
  render(<PanelSsh />);
  const row = screen.getByTestId('ssh-row-remote');
  fireEvent.keyDown(row, { key: 'F10', shiftKey: true });
  expect(screen.queryByRole('menuitem', { name: '图标颜色' })).toBeNull();
  expect(screen.queryByRole('group', { name: '图标颜色' })).toBeNull();
  expect(screen.getByRole('button', { name: '编辑连接' })).toBeVisible();
  expect(row.querySelector('svg')).toHaveAttribute('data-shell-mark', 'linux');
});
afterEach(() => { cleanup(); useSshStore.setState(snapshot, true); localStorage.removeItem('vrykell-ssh-workspace-view'); });

it('keeps the SSH tile color stable while selection highlights the row', () => {
  render(<PanelSsh />);
  const row = screen.getByTestId('ssh-row-remote');
  const icon = row.querySelector('svg')!;
  expect(icon).toHaveAttribute('data-shell-mark', 'linux');
  expect(icon.parentElement!.style.background).toBe('');
  const content = row.firstElementChild as HTMLElement;
  expect(content.style.color).toBe('var(--text-secondary)');
  fireEvent.click(row);
  expect(content.style.color).toBe('var(--text-primary)');
  expect(content.style.background).toBe('var(--selection-bg)');
  expect(icon.style.color).toBe('var(--text-primary)');
});

it('renders a filled yellow favorite independently of the row text color', () => {
  useHostLibrary.getState().update('remote', { starred: true });
  try {
    render(<PanelSsh />);
    const star = screen.getByTestId('ssh-row-remote').querySelector<SVGElement>('.sidebar-row-title > svg');
    expect(star?.style.color).toBe('var(--favorite-color)');
  } finally { useHostLibrary.setState({ hosts: {} }); }
});
