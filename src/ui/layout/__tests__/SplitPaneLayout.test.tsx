import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import SplitPaneLayout from '@ui/layout/SplitPaneLayout';
import { SplitPaneSurface } from '@ui/layout/SplitPane';
import { measurePaneTree } from '@core/paneLayout';

it('retains live pane nodes through resizing and shares the terminal divider and interior-only borders', () => {
  const geometry = measurePaneTree({ id: 'one' }, node => node);
  const renderPane = (cell: typeof geometry.cells[number]) => <SplitPaneSurface inner={cell.inner}><input aria-label={cell.id} /></SplitPaneSurface>;
  const resize = vi.fn(); const { container, rerender } = render(<SplitPaneLayout {...geometry} renderPane={renderPane} onRatio={resize} />);
  const input = screen.getByRole('textbox', { name: 'one' }); fireEvent.change(input, { target: { value: 'live draft' } });
  const split = { cells: [...geometry.cells, { ...geometry.cells[0], id: 'two' }], dividers: [{ aId: 'one', bId: 'two', dir: 'row' as const, ratio: 0.5, rect: { x: 0.5, y: 0, w: 0, h: 1 }, region: { x: 0, y: 0, w: 1, h: 1 } }] };
  rerender(<SplitPaneLayout {...split} renderPane={renderPane} onRatio={resize} />);
  expect(screen.getByRole('textbox', { name: 'one' })).toBe(input); expect(input).toHaveValue('live draft');
  expect(input.parentElement).toHaveStyle({ overflow: 'hidden' });
  expect(input.parentElement!.style.borderLeft).not.toContain('solid');
  const divider = screen.getByRole('separator'); expect(divider).toHaveStyle({ width: '6px', transform: 'translateX(-50%)' });
  vi.spyOn(container.firstElementChild!, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 1000, height: 600 } as DOMRect);
  fireEvent.keyDown(divider, { key: 'ArrowRight' }); expect(resize).toHaveBeenLastCalledWith('one', 'two', 0.516);
  fireEvent.mouseDown(divider); fireEvent.mouseMove(document, { clientX: 990 }); fireEvent.mouseUp(document);
  expect(resize).toHaveBeenLastCalledWith('one', 'two', 0.637);
});
