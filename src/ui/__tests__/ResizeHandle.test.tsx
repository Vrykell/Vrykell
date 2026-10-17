import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ResizeHandle from '../ResizeHandle';

afterEach(cleanup);

describe('ResizeHandle', () => {
  it.each(['left', 'right'] as const)('centers the drag strip across the %s boundary', (edge) => {
    const { getByTestId } = render(<ResizeHandle axis="x" edge={edge} testId="handle" onDelta={vi.fn()} />);
    const handle = getByTestId('handle');
    const line = handle.querySelector<HTMLElement>('[data-resize-line]')!;
    expect(handle.style.width).toBe('8px');
    expect(handle.style[edge]).toBe('-4px');
    expect(line.style.left).toBe('calc(50% - 0.5px)');
    fireEvent.mouseEnter(handle);
    expect(line.style.backgroundColor).toBe('var(--border-strong)');
    fireEvent.mouseLeave(handle);
    expect(line.style.backgroundColor).toBe('var(--resize-divider)');
  });

  it('keeps the active line during a drag and releases listeners on mouseup', () => {
    const onDelta = vi.fn();
    const onUp = vi.fn();
    const { getByTestId } = render(<ResizeHandle axis="x" testId="handle" onDelta={onDelta} onUp={onUp} />);
    const handle = getByTestId('handle');
    const line = handle.querySelector<HTMLElement>('[data-resize-line]')!;
    fireEvent.mouseDown(handle, { clientX: 200, clientY: 50 });
    fireEvent.mouseLeave(handle);
    fireEvent.mouseMove(document, { clientX: 240, clientY: 70 });
    expect(line.style.backgroundColor).toBe('var(--border-strong)');
    expect(onDelta).toHaveBeenCalledWith(40);
    fireEvent.mouseUp(document);
    expect(onUp).toHaveBeenCalledOnce();
    expect(document.body.style.cursor).toBe('');
    expect(line.style.backgroundColor).toBe('var(--resize-divider)');
    fireEvent.mouseMove(document, { clientX: 260, clientY: 70 });
    expect(onDelta).toHaveBeenCalledOnce();
  });

  it('provides keyboard resizing and reset for a labelled separator', () => {
    const onDelta = vi.fn(); const onUp = vi.fn(); const onReset = vi.fn();
    const { getByRole } = render(<ResizeHandle axis="y" label="Resize details" onDelta={onDelta} onUp={onUp} onReset={onReset} />);
    const handle = getByRole('separator', { name: 'Resize details' });
    expect(handle).toHaveAttribute('aria-orientation', 'horizontal');
    fireEvent.keyDown(handle, { key: 'ArrowUp' });
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    expect(onDelta.mock.calls).toEqual([[-16], [16]]);
    expect(onUp).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(handle, { key: 'Home' });
    fireEvent.doubleClick(handle);
    expect(onReset).toHaveBeenCalledTimes(2);
  });
});
