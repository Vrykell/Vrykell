import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ContextMenuItems } from '../ContextMenu';
afterEach(cleanup);
it('groups actions consistently and keeps destructive items last', () => {
  const items = [
    { label: 'Delete', danger: true, onClick: vi.fn() },
    { label: 'Rename', group: 'edit' as const, onClick: vi.fn() },
    { label: 'Open', group: 'primary' as const, onClick: vi.fn() },
    { label: 'Copy', group: 'clipboard' as const, onClick: vi.fn() },
    { label: 'Cut', group: 'clipboard' as const, order: -1, onClick: vi.fn() },
  ];
  render(<ContextMenuItems items={items} onClose={vi.fn()} />);
  expect(screen.getAllByRole('button').map(item => item.textContent)).toEqual(['Open', 'Cut', 'Copy', 'Rename', 'Delete']);
  expect(screen.getAllByRole('separator')).toHaveLength(3);
});
