import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import TooltipLayer from '../TooltipLayer';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('places a tall hint below a trigger near the top viewport edge', () => {
  vi.useFakeTimers();
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.dataset.testid === 'app-tooltip') {
      return { top: 0, bottom: 90, left: 0, right: 300, width: 300, height: 90 } as DOMRect;
    }
    return { top: 40, bottom: 64, left: 24, right: 48, width: 24, height: 24 } as DOMRect;
  });
  render(<><button data-tip="Group by" data-tip-description="A longer explanation of grouping">Group</button><TooltipLayer /></>);

  fireEvent.mouseOver(screen.getByRole('button', { name: 'Group' }));
  act(() => vi.advanceTimersByTime(300));

  expect(screen.getByTestId('app-tooltip')).toHaveStyle({ top: '70px', visibility: 'visible' });
});
