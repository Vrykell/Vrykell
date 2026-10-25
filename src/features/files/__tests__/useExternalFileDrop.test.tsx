import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { act, renderHook } from '@testing-library/react';
import type { EventCallback } from '@tauri-apps/api/event';
import type { DragDropEvent } from '@tauri-apps/api/window';
import { PhysicalPosition } from '@tauri-apps/api/dpi';
import { useExternalFileDrop } from '../hooks/useExternalFileDrop';

const mocks = vi.hoisted(() => ({ listen: vi.fn() }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ onDragDropEvent: mocks.listen }) }));

const target = { rowPath: null, dir: '/home/test' };
const paths = ['C:\\projects\\folder'];
const drop: DragDropEvent = { type: 'drop', paths, position: new PhysicalPosition(120, 80) };
let listeners: Set<EventCallback<DragDropEvent>>;
let subscriptions: { resolve: () => void; unlisten: ReturnType<typeof vi.fn> }[];

function emit(payload: DragDropEvent) {
  act(() => {
    for (const handler of listeners) handler({ event: 'tauri://drag-drop', id: 1, payload });
  });
}

async function finishSubscriptions() {
  await act(async () => {
    for (const subscription of subscriptions) subscription.resolve();
  });
}

beforeEach(() => {
  vi.stubGlobal('__TAURI_INTERNALS__', {});
  listeners = new Set();
  subscriptions = [];
  mocks.listen.mockReset().mockImplementation((handler: EventCallback<DragDropEvent>) => {
    listeners.add(handler);
    const unlisten = vi.fn(() => { listeners.delete(handler); });
    return new Promise<() => void>(resolve => {
      subscriptions.push({ resolve: () => resolve(unlisten), unlisten });
    });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('external file drop subscriptions', () => {
  it('uploads a dropped folder only once after effect replay', async () => {
    const onDrop = vi.fn();
    const view = renderHook(() => useExternalFileDrop({ resolveTarget: () => target, onHover: vi.fn(), onDrop }), { wrapper: StrictMode });
    await finishSubscriptions();

    emit(drop);

    expect(onDrop).toHaveBeenCalledExactlyOnceWith(paths, target);
    expect(listeners.size).toBe(1);
    view.unmount();
    expect(listeners.size).toBe(0);
  });

  it('ignores callbacks immediately after unmount and removes a late subscription', async () => {
    const resolveTarget = vi.fn(() => target);
    const onHover = vi.fn();
    const onDrop = vi.fn();
    const view = renderHook(() => useExternalFileDrop({ resolveTarget, onHover, onDrop }));
    view.unmount();

    emit(drop);
    emit({ type: 'leave' });

    expect(resolveTarget).not.toHaveBeenCalled();
    expect(onHover).not.toHaveBeenCalled();
    expect(onDrop).not.toHaveBeenCalled();
    await finishSubscriptions();
    expect(subscriptions[0]!.unlisten).toHaveBeenCalledOnce();
    expect(listeners.size).toBe(0);
  });

  it('accepts a second intentional drop of the same folder', async () => {
    const onDrop = vi.fn();
    renderHook(() => useExternalFileDrop({ resolveTarget: () => target, onHover: vi.fn(), onDrop }), { wrapper: StrictMode });
    await finishSubscriptions();

    emit(drop);
    emit(drop);

    expect(onDrop).toHaveBeenCalledTimes(2);
    expect(onDrop).toHaveBeenNthCalledWith(2, paths, target);
  });

  it('uses updated handlers without adding another subscription', async () => {
    const initialDrop = vi.fn();
    const nextDrop = vi.fn();
    const view = renderHook(({ onDrop }) => useExternalFileDrop({ resolveTarget: () => target, onHover: vi.fn(), onDrop }), { initialProps: { onDrop: initialDrop } });
    await finishSubscriptions();
    view.rerender({ onDrop: nextDrop });

    emit(drop);

    expect(initialDrop).not.toHaveBeenCalled();
    expect(nextDrop).toHaveBeenCalledExactlyOnceWith(paths, target);
    expect(mocks.listen).toHaveBeenCalledOnce();
  });

  it('converts physical coordinates and forwards all dropped paths to the target', async () => {
    vi.stubGlobal('devicePixelRatio', 2);
    const resolveTarget = vi.fn(() => target);
    const onHover = vi.fn();
    const onDrop = vi.fn();
    renderHook(() => useExternalFileDrop({ resolveTarget, onHover, onDrop }));
    await finishSubscriptions();

    emit({ type: 'over', position: new PhysicalPosition(120, 80) });
    expect(onHover).toHaveBeenLastCalledWith(target);
    emit({ ...drop, paths: [...paths, 'C:\\projects\\another'] });

    expect(resolveTarget).toHaveBeenLastCalledWith(60, 40);
    expect(onDrop).toHaveBeenCalledExactlyOnceWith([...paths, 'C:\\projects\\another'], target);
    expect(onHover).toHaveBeenLastCalledWith(null);
  });

  it('does not handle a drop outside its panel or an empty drop', async () => {
    const resolveTarget = vi.fn((): typeof target | null => null);
    const onDrop = vi.fn();
    renderHook(() => useExternalFileDrop({ resolveTarget, onHover: vi.fn(), onDrop }));
    await finishSubscriptions();

    emit(drop);
    resolveTarget.mockReturnValue(target);
    emit({ ...drop, paths: [] });

    expect(onDrop).not.toHaveBeenCalled();
  });

  it('does not subscribe in a browser without the native runtime', () => {
    vi.stubGlobal('__TAURI_INTERNALS__', undefined);
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    renderHook(() => useExternalFileDrop({ resolveTarget: () => target, onHover: vi.fn(), onDrop: vi.fn() }));

    expect(mocks.listen).not.toHaveBeenCalled();
  });
});
