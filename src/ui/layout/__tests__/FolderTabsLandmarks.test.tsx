import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import FolderTabs from '@ui/layout/FolderTabs';

it('keeps the empty hint outside the tablist and renders no second banner header', () => {
  const view = render(<FolderTabs items={[]} selected="" label="Open documents" toolbar={null}
    empty={<div data-testid="empty-hint">No matching sessions</div>}
    onSelect={vi.fn()} onClose={vi.fn()} onMove={vi.fn()} />);

  const tablist = screen.getByRole('tablist', { name: 'Open documents' });
  expect(tablist).not.toContainElement(screen.getByTestId('empty-hint'));
  expect(screen.getByRole('status')).toContainElement(screen.getByTestId('empty-hint'));
  expect(view.container.querySelector('header')).toBeNull();
});
