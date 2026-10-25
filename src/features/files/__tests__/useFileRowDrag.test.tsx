import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useFileDragStore } from '@features/files/stores/fileDrag';
import { useFileRowDrag } from '@features/files/hooks/useFileRowDrag';

const startDragMock = vi.hoisted(() => vi.fn());

vi.mock('@crabnebula/tauri-plugin-drag', () => ({ startDrag: startDragMock }));

const items = [{ path: '/tmp/a.txt', name: 'a.txt', is_dir: false }];

/** The hook listens through window pointer events; jsdom has no PointerEvent, so carry pointerId on a MouseEvent. */
function pointerMove(pointerId: number, clientX: number, clientY: number): Event {
  const event = new MouseEvent('pointermove', { clientX, clientY });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  return event;
}

function pointerDown(pointerId = 1): React.PointerEvent<HTMLElement> {
  const source = document.createElement('div');
  return {
    button: 0,
    isPrimary: true,
    pointerId,
    clientX: 10,
    clientY: 10,
    target: source,
    currentTarget: source,
    preventDefault: vi.fn(),
  } as unknown as React.PointerEvent<HTMLElement>;
}

describe('useFileRowDrag native drag-out', () => {
  beforeEach(() => {
    startDragMock.mockReset();
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
  });

  afterEach(() => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    useFileDragStore.getState().end();
  });

  it('passes the downloaded local paths to onNativeDragEnd when the drag is cancelled', async () => {
    const payload = { paths: ['/home/u/.vrykell/downloads/a.txt'], mode: 'copy' as const };
    startDragMock.mockImplementation((_options: unknown, onEnd: (event: { result: string }) => void) => {
      onEnd({ result: 'Cancelled' });
      return Promise.resolve();
    });
    const onNativeDragEnd = vi.fn();
    const prepareNativeDrag = vi.fn().mockResolvedValue(payload);
    const { result } = renderHook(() => useFileRowDrag({ onDrop: vi.fn(), prepareNativeDrag, onNativeDragEnd }));

    await act(async () => {
      result.current(pointerDown(), items);
      window.dispatchEvent(pointerMove(1, -20, 10));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(prepareNativeDrag).toHaveBeenCalledWith(items);
    expect(onNativeDragEnd).toHaveBeenCalledWith('Cancelled', items, payload);
  });

  it('hands the item paths straight to the OS for the local panel and reports them back', async () => {
    startDragMock.mockImplementation((_options: unknown, onEnd: (event: { result: string }) => void) => {
      onEnd({ result: 'Dropped' });
      return Promise.resolve();
    });
    const onNativeDragEnd = vi.fn();
    const { result } = renderHook(() => useFileRowDrag({ onDrop: vi.fn(), onNativeDragEnd }));

    await act(async () => {
      result.current(pointerDown(), items);
      window.dispatchEvent(pointerMove(1, -20, 10));
    });

    expect(startDragMock).toHaveBeenCalledWith(
      { item: ['/tmp/a.txt'], icon: '', mode: 'move' },
      expect.any(Function),
    );
    expect(onNativeDragEnd).toHaveBeenCalledWith('Dropped', items, { paths: ['/tmp/a.txt'], mode: 'move' });
  });

  it('prepares one download while repeated pointer moves cross the window edge', async () => {
    let finish: (payload: { paths: string[]; mode: 'copy' }) => void = () => {};
    const prepareNativeDrag = vi.fn(() => new Promise<{ paths: string[]; mode: 'copy' }>(resolve => { finish = resolve; }));
    startDragMock.mockResolvedValue(undefined);
    const { result } = renderHook(() => useFileRowDrag({ onDrop: vi.fn(), prepareNativeDrag }));

    await act(async () => {
      result.current(pointerDown(), items);
      window.dispatchEvent(pointerMove(1, -20, 10));
      window.dispatchEvent(pointerMove(1, -30, 10));
      window.dispatchEvent(pointerMove(1, -40, 10));
    });
    expect(prepareNativeDrag).toHaveBeenCalledExactlyOnceWith(items);
    expect(startDragMock).not.toHaveBeenCalled();

    await act(async () => { finish({ paths: ['/Downloads/folder'], mode: 'copy' }); });
    expect(startDragMock).toHaveBeenCalledOnce();
  });
});
