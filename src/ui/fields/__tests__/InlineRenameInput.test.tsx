import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import InlineRenameInput from '@ui/fields/InlineRenameInput';

it('uses the shared fixed-width field without a content-dependent measure', () => {
  const change = vi.fn(); const key = vi.fn();
  const { container, rerender } = render(<InlineRenameInput aria-label="Rename" value="短名称" onChange={change} onKeyDown={key} />);
  expect(container.querySelector('.inline-rename-measure')).toBeNull();
  const input = screen.getByRole('textbox', { name: 'Rename' });
  expect(input).toHaveClass('text-input-field');
  fireEvent.change(input, { target: { value: 'Longer name' } }); expect(change).toHaveBeenCalledOnce();
  fireEvent.keyDown(input, { key: 'Escape' }); expect(key).toHaveBeenCalledOnce();
  rerender(<InlineRenameInput aria-label="Rename" value={'Long name '.repeat(50)} onChange={change} />);
  expect(input).toHaveValue('Long name '.repeat(50)); expect(container.querySelector('.inline-rename-fit')).not.toBeNull();
});
