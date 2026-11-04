import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import PageBreadcrumb from '../PageBreadcrumb';
afterEach(cleanup);
it('shares page navigation with an actionable ancestor and current destination', () => {
  const back = vi.fn();
  render(<PageBreadcrumb ancestors={[{ label: 'Skills', onClick: back }]} current="Review" meta="5 items" />);
  expect(screen.getByRole('navigation', { name: '页面导航' })).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Review' })).toHaveAttribute('aria-current', 'page');
  fireEvent.click(screen.getByRole('button', { name: 'Skills' })); expect(back).toHaveBeenCalledOnce();
  expect(screen.getByText('5 items')).toBeVisible();
});
