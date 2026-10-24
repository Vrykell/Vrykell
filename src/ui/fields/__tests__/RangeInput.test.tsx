import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { RangeInput } from '@ui/fields/RangeInput';

it('keeps range progress bounded and retains native keyboard semantics', () => {
  const change = vi.fn();
  const { rerender } = render(<RangeInput aria-label="Opacity" min={0.5} max={1} step={0.05} value={0.75} onChange={change} />);
  const slider = screen.getByRole('slider', { name: 'Opacity' });
  expect(slider).toHaveStyle({ backgroundSize: '50% 4px' });
  fireEvent.change(slider, { target: { value: '0.8' } });
  expect(change).toHaveBeenCalledOnce();
  rerender(<RangeInput aria-label="Opacity" min={0.5} max={1} value={2} onChange={change} />);
  expect(slider).toHaveStyle({ backgroundSize: '100% 4px' });
});
