import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import Toggle from '@ui/fields/Toggle';

afterEach(cleanup);
it('exposes the current state and requests an explicit toggle', () => {
  const change = vi.fn();
  const view = render(<Toggle on={false} label="Resource usage" onChange={change} />);
  fireEvent.click(screen.getByRole('switch', { name: 'Resource usage' }));
  expect(change).toHaveBeenCalledWith(true);
  view.rerender(<Toggle on label="Resource usage" onChange={change} />);
  expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
});

it('uses the compact toolbar geometry without changing its state semantics', () => {
  render(<Toggle compact on label="Resource usage" onChange={vi.fn()} />);
  expect(screen.getByRole('switch')).toHaveStyle({ width: '32px', height: '18px' });
  expect(screen.getByRole('switch').firstElementChild).toHaveStyle({ width: '14px', left: '16px' });
});
