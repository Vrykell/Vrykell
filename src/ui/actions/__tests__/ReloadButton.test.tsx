import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ReloadButton from '../ReloadButton';

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });

it('keeps keyboard focus during reload feedback and refuses repeated activation', async () => {
  const reload = vi.fn();
  render(<ReloadButton label="Reload" onReload={reload} />);
  const button = screen.getByRole('button', { name: 'Reload' });
  button.focus();
  await act(async () => { fireEvent.click(button); });
  expect(button).toHaveFocus();
  expect(button).toHaveAttribute('aria-disabled', 'true');
  expect(button).not.toBeDisabled();
  fireEvent.click(button);
  expect(reload).toHaveBeenCalledOnce();
  act(() => vi.advanceTimersByTime(800));
  expect(button).toHaveAttribute('aria-disabled', 'false');
  expect(button).toHaveFocus();
});

it('honors external disabled and busy states without invoking the action', () => {
  const reload = vi.fn();
  const { rerender } = render(<ReloadButton label="Reload" disabled onReload={reload} />);
  const button = screen.getByRole('button', { name: 'Reload' });
  expect(button).toBeDisabled();
  fireEvent.click(button);
  rerender(<ReloadButton label="Reload" busy onReload={reload} />);
  fireEvent.click(button);
  expect(reload).not.toHaveBeenCalled();
  expect(button).toHaveAttribute('aria-busy', 'true');
});
