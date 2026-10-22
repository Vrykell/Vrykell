import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import PanelSsh from '../components/PanelSsh';
import { useSshStore } from '../stores/store';
import { useIconColorStore } from '@config/iconColors';

const snapshot = useSshStore.getState();
beforeEach(() => {
  localStorage.setItem('vrykell-ssh-workspace-view', 'manage');
  useIconColorStore.setState({ colors: {} });
  useSshStore.setState({
    loaded: true,
    connections: [{ id: 'remote', name: 'Remote', host: 'example.invalid', user: 'tester', authMethod: 'key' }],
  });
});

it('selects and resets persistent connection colors from its keyboard menu', () => {
  render(<PanelSsh />);
  const row = screen.getByTestId('ssh-row-remote');
  fireEvent.keyDown(row, { key: 'F10', shiftKey: true });
  expect(screen.queryByRole('menuitem', { name: '图标颜色' })).toBeNull();
  expect(screen.getByRole('group', { name: '图标颜色' }).closest('.context-menu-footer')).not.toBeNull();
  fireEvent.click(screen.getByRole('menuitemradio', { name: '紫色' }));
  expect(row.querySelector('svg')!.style.color).toBe('var(--group-violet)');
  expect(useIconColorStore.getState().colors['ssh:remote']).toBe('violet');
  expect(row).toHaveFocus();
  fireEvent.contextMenu(row);
  fireEvent.click(screen.getByTestId('ssh-icon-color-auto'));
  expect(row.querySelector('svg')!.style.color).toBe('var(--shell-ssh-accent)');
});
afterEach(() => { cleanup(); useSshStore.setState(snapshot, true); localStorage.removeItem('vrykell-ssh-workspace-view'); });

it('keeps the SSH tile color stable while selection highlights the row', () => {
  render(<PanelSsh />);
  const row = screen.getByTestId('ssh-row-remote');
  const icon = row.querySelector('svg')!;
  expect(icon).toHaveAttribute('data-shell-mark', 'ssh');
  expect(icon.parentElement!.style.background).toBe('');
  const content = row.firstElementChild as HTMLElement;
  expect(content.style.color).toBe('var(--text-secondary)');
  fireEvent.click(row);
  expect(content.style.color).toBe('var(--text-primary)');
  expect(content.style.background).toBe('var(--selection-bg)');
  expect(icon.style.color).toBe('var(--shell-ssh-accent)');
});
