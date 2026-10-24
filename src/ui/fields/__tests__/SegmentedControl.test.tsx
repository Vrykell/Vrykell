import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import SegmentedControl from '@ui/fields/SegmentedControl';

afterEach(cleanup);
it('selects only through clicks or keyboard navigation, not hover', () => {
  const change = vi.fn();
  render(<SegmentedControl label="Authentication" value="password" options={[{ value: 'password', label: 'Password' }, { value: 'key', label: 'Private key' }]} onChange={change} />);
  const key = screen.getByRole('radio', { name: 'Private key' });
  fireEvent.mouseEnter(key); expect(change).not.toHaveBeenCalled();
  fireEvent.click(key); expect(change).toHaveBeenCalledWith('key');
  fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'ArrowRight' });
  expect(key).toHaveFocus();
  expect(screen.getByRole('radio', { name: 'Password' })).toHaveAttribute('aria-checked', 'true');
});
