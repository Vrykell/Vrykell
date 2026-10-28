import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import SegmentedControl from '@ui/fields/SegmentedControl';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
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

it('measures the selected button in both dimensions after a wrapped layout changes selection', () => {
  const options = [{ value: 'password', label: 'Password' }, { value: 'key', label: 'Private key' }];
  const view = render(<SegmentedControl label="Authentication" value="password" options={options} onChange={() => {}} />);
  const key = screen.getByRole('radio', { name: 'Private key' });
  Object.defineProperties(key, { offsetLeft: { value: 4 }, offsetTop: { value: 38 }, offsetWidth: { value: 160 }, offsetHeight: { value: 32 } });
  view.rerender(<SegmentedControl label="Authentication" value="key" options={options} onChange={() => {}} />);
  expect(view.container.querySelector('.segmented-selection')).toHaveStyle({ transform: 'translate(4px, 38px)', width: '160px', height: '32px' });
});

it('preserves button-group semantics and roving focus for view choices', () => {
  const onChange = vi.fn();
  render(<SegmentedControl variant="buttons" label="View" value="list" options={[{ value: 'list', label: 'List' }, { value: 'cards', label: 'Cards' }]} onChange={onChange} />);
  expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.queryByRole('radio')).toBeNull();
  fireEvent.keyDown(screen.getByRole('button', { name: 'List' }), { key: 'End' });
  expect(onChange).toHaveBeenCalledWith('cards');
  expect(screen.getByRole('button', { name: 'Cards' })).toHaveFocus();
});
