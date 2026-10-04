import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useDockDragStore } from '@features/workspace';
import { useTerminalPaneDrag } from '@features/terminal/hooks/useTerminalPaneDrag';

describe('useTerminalPaneDrag', () => {
  const dragSnapshot = useDockDragStore.getState();

  afterEach(() => {
    useDockDragStore.setState(dragSnapshot, true);
  });

  it('starts dragging only after the pointer crosses the threshold and cleans up on release', () => {
    const surface = document.createElement('div');
    const preventDefault = vi.fn();
    const { result } = renderHook(() => useTerminalPaneDrag('pane-1'));

    act(() => result.current({
      button: 0,
      target: surface,
      clientX: 10,
      clientY: 10,
      preventDefault,
    } as unknown as React.MouseEvent));
    act(() => document.dispatchEvent(new MouseEvent('mousemove', { clientX: 14, clientY: 14 })));
    expect(useDockDragStore.getState().draggingTerminalId).toBeNull();

    act(() => document.dispatchEvent(new MouseEvent('mousemove', { clientX: 16, clientY: 10 })));
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(useDockDragStore.getState().draggingTerminalId).toBe('pane-1');

    act(() => document.dispatchEvent(new MouseEvent('mouseup')));
    useDockDragStore.getState().end();
    act(() => document.dispatchEvent(new MouseEvent('mousemove', { clientX: 30, clientY: 30 })));
    expect(useDockDragStore.getState().draggingTerminalId).toBeNull();
  });

  it('does not capture interactive descendants', () => {
    const input = document.createElement('input');
    const preventDefault = vi.fn();
    const { result } = renderHook(() => useTerminalPaneDrag('pane-2'));

    act(() => result.current({
      button: 0,
      target: input,
      clientX: 0,
      clientY: 0,
      preventDefault,
    } as unknown as React.MouseEvent));
    act(() => document.dispatchEvent(new MouseEvent('mousemove', { clientX: 20, clientY: 20 })));

    expect(preventDefault).not.toHaveBeenCalled();
    expect(useDockDragStore.getState().draggingTerminalId).toBeNull();
  });

  it('does not intercept pointer gestures when no other pane can be reordered', () => {
    const preventDefault = vi.fn();
    const { result } = renderHook(() => useTerminalPaneDrag('pane-1', false));
    act(() => result.current({
      button: 0, target: document.createElement('div'), clientX: 0, clientY: 0, preventDefault,
    } as unknown as React.MouseEvent));
    act(() => document.dispatchEvent(new MouseEvent('mousemove', { clientX: 30, clientY: 30 })));
    act(() => document.dispatchEvent(new MouseEvent('mouseup')));
    expect(preventDefault).not.toHaveBeenCalled();
    expect(useDockDragStore.getState().draggingTerminalId).toBeNull();
  });
});
