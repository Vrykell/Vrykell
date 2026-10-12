import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import PanelSsh from '../components/PanelSsh';
import { useSshStore } from '../stores/store';

const snapshot = useSshStore.getState();
beforeEach(() => {
  useSshStore.setState({
    loaded: true,
    connections: [{ id: 'remote', name: 'Remote', host: 'example.invalid', user: 'tester', authMethod: 'key' }],
  });
});
afterEach(() => { cleanup(); useSshStore.setState(snapshot, true); });

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
