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
    return { rect, header };
  };
  return { scroll, add };
}

beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }));
afterEach(() => vi.unstubAllGlobals());

describe('viewport command header', () => {
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
});
