import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import FilterChip from '../FilterChip';

it('shows the condition as a card and removes it only through its labeled button', () => {
  const remove = vi.fn();
  render(<FilterChip removeLabel="Remove status filter" onRemove={remove} testId="filter">Succeeded</FilterChip>);
  fireEvent.click(screen.getByText('Succeeded'));
  expect(remove).not.toHaveBeenCalled();
  expect(screen.getByTestId('filter')).toHaveClass('search-scope-chip');
  fireEvent.click(screen.getByRole('button', { name: 'Remove status filter' }));
  expect(remove).toHaveBeenCalledOnce();
});
