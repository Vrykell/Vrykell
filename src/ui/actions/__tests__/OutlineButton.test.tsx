import { createRef } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { OutlineButton } from '@ui/actions/OutlineButton';

afterEach(cleanup);

it('forwards native attributes and refs without submitting an enclosing form', () => {
  const click = vi.fn();
  const submit = vi.fn(event => event.preventDefault());
  const ref = createRef<HTMLButtonElement>();
  render(<form onSubmit={submit}><OutlineButton ref={ref} aria-label="Add assistant" data-subtle onClick={click}>Add</OutlineButton></form>);
  const button = screen.getByRole('button', { name: 'Add assistant' });
  expect(ref.current).toBe(button);
  fireEvent.click(button);
  expect(click).toHaveBeenCalledOnce();
  expect(submit).not.toHaveBeenCalled();
});

it('preserves disabled behavior and explicit submit actions', () => {
  const click = vi.fn();
  const submit = vi.fn(event => event.preventDefault());
  const { rerender } = render(<OutlineButton disabled onClick={click}>Import</OutlineButton>);
  fireEvent.click(screen.getByRole('button', { name: 'Import' }));
  expect(click).not.toHaveBeenCalled();
  rerender(<form onSubmit={submit}><OutlineButton type="submit" onClick={click}>Import</OutlineButton></form>);
  fireEvent.click(screen.getByRole('button', { name: 'Import' }));
  expect(click).toHaveBeenCalledOnce();
  expect(submit).toHaveBeenCalledOnce();
});
