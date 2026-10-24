import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { PlacementOverlay } from '@ui/layout/PanePlacement';
import { measurePaneTree } from '@core/paneLayout';

it('shares the hover preview, keyboard choice and cancellation without creating a resource before placement', () => {
  const targets = measurePaneTree('pane', id => ({ id })).targets; const pick = vi.fn(); const cancel = vi.fn();
  render(<PlacementOverlay targets={targets} onPick={pick} onCancel={cancel} hint="Choose position" />);
  const overlay = screen.getByTestId('placement-overlay');
  vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 1000, height: 600 } as DOMRect);
  expect(screen.queryByTestId('placement-zone-0')).toBeNull();
  fireEvent.mouseMove(overlay, { clientX: 900, clientY: 300 }); expect(screen.getByTestId('placement-zone-1')).toBeVisible();
  fireEvent.click(overlay, { clientX: 900, clientY: 300 }); expect(pick).toHaveBeenCalledWith(targets[1]);
  fireEvent.keyDown(overlay, { key: 'ArrowDown' }); fireEvent.keyDown(overlay, { key: 'Enter' }); expect(pick).toHaveBeenLastCalledWith(targets[2]);
  fireEvent.keyDown(window, { key: 'Escape' }); expect(cancel).toHaveBeenCalledTimes(1);
});
