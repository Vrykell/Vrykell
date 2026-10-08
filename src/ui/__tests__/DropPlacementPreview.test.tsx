import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import DropPlacementPreview from '../DropPlacementPreview';

it('preserves the target bounds and switches the shared active surface', () => {
  const { rerender } = render(<DropPlacementPreview data-testid="drop" style={{ width: 280, height: 600 }}>Release</DropPlacementPreview>);
  expect(screen.getByTestId('drop')).toHaveStyle({ width: '280px', height: '600px' });
  expect(screen.getByTestId('drop')).toHaveAttribute('data-active', 'true');
  rerender(<DropPlacementPreview active={false} data-testid="drop" />);
  expect(screen.getByTestId('drop')).toHaveClass('drop-placement-preview');
  expect(screen.getByTestId('drop')).toHaveAttribute('data-active', 'false');
});
