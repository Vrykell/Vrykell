import { describe, expect, it, vi } from 'vitest';
import { beginLayoutResizeDrag, endLayoutResizeDrag, isLayoutResizeDragActive, onLayoutResizeDragEnd } from '../layoutResizeDrag';

describe('layout resize drag state', () => {
  it('tracks nested drags and only ends when the last one is released', () => {
    expect(isLayoutResizeDragActive()).toBe(false);
    beginLayoutResizeDrag();
    beginLayoutResizeDrag();
    expect(isLayoutResizeDragActive()).toBe(true);
    endLayoutResizeDrag();
    expect(isLayoutResizeDragActive()).toBe(true);
    endLayoutResizeDrag();
    expect(isLayoutResizeDragActive()).toBe(false);
  });

  it('notifies the end listeners once per completed drag and ignores stray ends', () => {
    const listener = vi.fn();
    const unsubscribe = onLayoutResizeDragEnd(listener);
    endLayoutResizeDrag();
    expect(listener).not.toHaveBeenCalled();
    beginLayoutResizeDrag();
    endLayoutResizeDrag();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    beginLayoutResizeDrag();
    endLayoutResizeDrag();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
