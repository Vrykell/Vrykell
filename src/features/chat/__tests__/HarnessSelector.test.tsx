import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import HarnessSelector from '../components/HarnessSelector';

it('renders model choices as searchable full-width rows and selects with the keyboard', () => {
  const change = vi.fn();
  render(<HarnessSelector label="Model" value="model-9" options={Array.from({ length: 12 }, (_, index) => ({ value: `model-${index}`, label: `Provider/Model ${index}`, description: `Description ${index}` }))} onChange={change} testId="selector" />);
  fireEvent.click(screen.getByTestId('selector'));
  expect(screen.getByRole('listbox')).toHaveClass('harness-select-options');
  expect(screen.getByRole('option', { name: /Provider\/Model 9/ })).toHaveClass('harness-select-option');
  const search = screen.getByRole('textbox');
  fireEvent.change(search, { target: { value: 'Model 10' } });
  expect(screen.getAllByRole('option')).toHaveLength(1);
  fireEvent.keyDown(search, { key: 'ArrowDown' });
  expect(screen.getByRole('option')).toHaveFocus();
  fireEvent.click(screen.getByRole('option'));
  expect(change).toHaveBeenCalledWith('model-10');
  expect(screen.getByTestId('selector')).toHaveFocus();
});

it('renders shared family marks only for model selectors', () => {
  const { rerender } = render(<HarnessSelector model label="Model" value="opencode-go/mimo-v2.6-pro" options={[{ value: 'opencode-go/mimo-v2.6-pro', label: 'mimo-v2.6-pro' }]} onChange={vi.fn()} testId="model-selector" />);
  fireEvent.click(screen.getByTestId('model-selector'));
  expect(screen.getByRole('option').querySelectorAll('svg')).toHaveLength(2);
  rerender(<HarnessSelector label="Mode" value="default" options={[{ value: 'default', label: 'Default' }]} onChange={vi.fn()} testId="model-selector" />);
  expect(screen.getByRole('option').querySelectorAll('svg')).toHaveLength(1);
});
