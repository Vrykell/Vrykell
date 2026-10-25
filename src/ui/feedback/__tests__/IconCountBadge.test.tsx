import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import IconCountBadge from '../IconCountBadge';

afterEach(cleanup);
it('preserves the content icon and places only multi-pane counts in its corner badge', () => {
  const view = render(<IconCountBadge count={3}><svg data-testid="content-icon" /></IconCountBadge>);
  expect(screen.getByTestId('content-icon')).toBeInTheDocument();
  expect(view.container.querySelector('[data-icon-count="3"] .icon-count-badge-dot')).toHaveTextContent('3');
  for (const count of [1, 0, NaN]) {
    view.rerender(<IconCountBadge count={count}><svg data-testid="content-icon" /></IconCountBadge>);
    expect(screen.getByTestId('content-icon')).toBeInTheDocument();
    expect(view.container.querySelector('.icon-count-badge-dot')).toBeNull();
  }
});
