import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import HistoryColorPalette from '../HistoryColorPalette';

afterEach(cleanup);

const anchor = { x: 40, y: 40 };

describe('HistoryColorPalette', () => {
  it('renders every swatch plus the automatic option', () => {
    const { container } = render(<HistoryColorPalette anchor={anchor} value={null} onSelect={() => {}} onClose={() => {}} testId="palette" />);
    expect(container.querySelectorAll('.history-palette-swatch')).toHaveLength(0);
    expect(screen.getByTestId('palette').querySelectorAll('.history-palette-swatch')).toHaveLength(8);
    expect(screen.getByTestId('palette-auto')).toBeTruthy();
  });

  it('selects a color and the automatic reset', () => {
    const onSelect = vi.fn();
    render(<HistoryColorPalette anchor={anchor} value={null} onSelect={onSelect} onClose={() => {}} testId="palette" />);
    const swatches = screen.getByTestId('palette').querySelectorAll<HTMLButtonElement>('.history-palette-swatch');
    fireEvent.click(swatches[0]!);
    expect(onSelect).toHaveBeenCalledWith('blue');
    fireEvent.click(screen.getByTestId('palette-auto'));
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it('marks the active swatch and the automatic state', () => {
    render(<HistoryColorPalette anchor={anchor} value="cyan" onSelect={() => {}} onClose={() => {}} testId="palette" />);
    const swatches = screen.getByTestId('palette').querySelectorAll<HTMLButtonElement>('.history-palette-swatch');
    expect(swatches[0]!.getAttribute('aria-pressed')).toBe('false');
    expect(swatches[4]!.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('palette-auto').getAttribute('aria-pressed')).toBe('false');
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<HistoryColorPalette anchor={anchor} value={null} onSelect={() => {}} onClose={onClose} testId="palette" />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
