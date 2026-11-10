import { act, fireEvent, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { measurePinnedCommand, usePinnedCommand } from '../hooks/usePinnedCommand';

function bounds(top: number, bottom: number): DOMRect {
  return { top, bottom, left: 0, right: 600, width: 600, height: bottom - top, x: 0, y: top, toJSON: () => ({}) };
}
function fixture() {
  const scroll = document.createElement('div');
  const flow = document.createElement('div');
  scroll.appendChild(flow);
  vi.spyOn(scroll, 'getBoundingClientRect').mockReturnValue(bounds(100, 500));
  const add = (id: string, top: number, bottom: number, titleBottom: number) => {
    const block = document.createElement('div');
    block.dataset.commandBlockId = id;
    const title = document.createElement('div');
    title.className = 'command-block-command';
    block.appendChild(title);
    flow.appendChild(block);
    const rect = vi.spyOn(block, 'getBoundingClientRect').mockReturnValue(bounds(top, bottom));
    const header = vi.spyOn(title, 'getBoundingClientRect').mockReturnValue(bounds(top, titleBottom));
    return { block, rect, header };
  };
  return { scroll, add };
}

beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }));
afterEach(() => vi.unstubAllGlobals());

describe('viewport command header', () => {
  it('updates an existing overlay offset without rendering the history pane again', async () => {
    const { scroll, add } = fixture();
    const item = add('live', 20, 900, 70);
    const parent = document.createElement('div');
    const clip = document.createElement('div');
    clip.className = 'pinned-command-clip';
    const overlay = document.createElement('div');
    overlay.className = 'pinned-command';
    clip.append(overlay);
    parent.append(scroll, clip);
    document.body.append(parent);
    const view = renderHook(() => usePinnedCommand({ current: scroll }));
    try {
      await waitFor(() => expect(view.result.current?.id).toBe('live'));
      const previous = view.result.current;
      act(() => {
        item.rect.mockReturnValue(bounds(10, 890));
        fireEvent.scroll(scroll);
      });
      expect(view.result.current).toBe(previous);
      expect(overlay.style.getPropertyValue('--pinned-command-remaining')).toBe('790px');
    } finally { view.unmount(); parent.remove(); }
  });
  it('finds the visible command without reading every historical block geometry', () => {
    const { scroll, add } = fixture();
    const items = Array.from({ length: 1024 }, (_, index) =>
      add(String(index), (index - 1023) * 100, (index - 1023) * 100 + 200, (index - 1023) * 100 + 30));
    expect(measurePinnedCommand(scroll)?.id).toBe('1023');
    expect(items.reduce((total, item) => total + item.rect.mock.calls.length, 0)).toBeLessThan(15);
  });
  it('pins running controls as soon as their status row starts to leave view, even while the command is visible', () => {
    const { scroll, add } = fixture();
    const item = add('running', 20, 900, 150);
    item.block.dataset.running = 'true';
    const row = document.createElement('div');
    row.className = 'command-block-info';
    item.block.prepend(row);
    const rowBounds = vi.spyOn(row, 'getBoundingClientRect').mockReturnValue(bounds(20, 90));
    expect(measurePinnedCommand(scroll)).toEqual({ id: 'running', remaining: 800 });
    // Partially above the edge: the toolbar must already be pinned instead of painted in half.
    rowBounds.mockReturnValue(bounds(90, 130));
    expect(measurePinnedCommand(scroll)).toEqual({ id: 'running', remaining: 800 });
    rowBounds.mockReturnValue(bounds(100, 140));
    expect(measurePinnedCommand(scroll)).toBeNull();
    rowBounds.mockReturnValue(bounds(101, 141));
    expect(measurePinnedCommand(scroll)).toBeNull();
    item.rect.mockReturnValue(bounds(-400, 80));
    expect(measurePinnedCommand(scroll)).toBeNull();
  });
  it('keeps completed command lines scrolling until they fully leave view', () => {
    const { scroll, add } = fixture();
    const item = add('done', 20, 900, 150);
    item.header.mockReturnValue(bounds(90, 110));
    expect(measurePinnedCommand(scroll)).toBeNull();
    item.header.mockReturnValue(bounds(80, 100));
    expect(measurePinnedCommand(scroll)).toEqual({ id: 'done', remaining: 800 });
  });
  it('waits until the original title leaves view and follows the block crossing the top', () => {
    const { scroll, add } = fixture();
    const first = add('first', 50, 450, 130);
    const second = add('second', 450, 900, 490);
    expect(measurePinnedCommand(scroll)).toBeNull();
    first.header.mockReturnValue(bounds(-50, 90));
    expect(measurePinnedCommand(scroll)).toEqual({ id: 'first', remaining: 350 });
    first.rect.mockReturnValue(bounds(-400, 80));
    second.rect.mockReturnValue(bounds(80, 500));
    second.header.mockReturnValue(bounds(80, 95));
    expect(measurePinnedCommand(scroll)).toEqual({ id: 'second', remaining: 400 });
  });

  it('clears the title in gaps, at the original heading and in hidden panes', () => {
    const { scroll, add } = fixture();
    add('earlier', -200, 80, -160);
    add('later', 180, 500, 220);
    expect(measurePinnedCommand(scroll)).toBeNull();
    vi.spyOn(scroll, 'getBoundingClientRect').mockReturnValue(bounds(0, 0));
    expect(measurePinnedCommand(scroll)).toBeNull();
  });

  it('reacts to scroll and removes subscriptions on unmount', async () => {
    const { scroll, add } = fixture();
    const item = add('live', 20, 900, 70);
    const remove = vi.spyOn(scroll, 'removeEventListener');
    const { result, unmount } = renderHook(() => usePinnedCommand({ current: scroll }));
    await waitFor(() => expect(result.current?.id).toBe('live'));
    act(() => {
      item.rect.mockReturnValue(bounds(-500, 90));
      fireEvent.scroll(scroll);
    });
    await waitFor(() => expect(result.current).toBeNull());
    unmount();
    expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function));
  });
  it('refreshes cached history membership when a command is appended', async () => {
    const { scroll, add } = fixture();
    const first = add('first', 20, 900, 70);
    const { result } = renderHook(() => usePinnedCommand({ current: scroll }));
    await waitFor(() => expect(result.current?.id).toBe('first'));
    act(() => {
      first.rect.mockReturnValue(bounds(-500, 90));
      add('next', 80, 500, 95);
    });
    await waitFor(() => expect(result.current?.id).toBe('next'));
  });
});
