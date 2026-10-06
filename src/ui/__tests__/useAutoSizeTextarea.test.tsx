import { useRef } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAutoSizeTextarea } from '../hooks/useAutoSizeTextarea';

function Composer({ value = '', enabled = true }: { value?: string; enabled?: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useAutoSizeTextarea(ref, value, 120, enabled);
  return <textarea ref={ref} value={value} placeholder="请输入内容" readOnly />;
}

describe('textarea size recovery', () => {
  let width: number;
  let notify: () => void;
  let measuredHeights: string[];
  const disconnect = vi.fn();

  beforeEach(() => {
    width = 400;
    measuredHeights = [];
    vi.spyOn(HTMLTextAreaElement.prototype, 'clientWidth', 'get').mockImplementation(() => width);
    vi.spyOn(HTMLTextAreaElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLTextAreaElement) {
      measuredHeights.push(this.style.height);
      return width < 200 ? 180 : this.value.includes('\n') ? 48 : 24;
    });
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { notify = callback; }
      observe() {}
      disconnect = disconnect;
    });
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); disconnect.mockClear(); });

  it('shrinks empty placeholder and draft fields again when width is restored', () => {
    const { container, rerender, unmount } = render(<Composer />);
    const input = container.querySelector('textarea')!;
    expect(input.style.height).toBe('24px');
    for (const value of ['', '草稿']) {
      rerender(<Composer value={value} />);
      width = 100;
      act(() => notify());
      expect(input.style.height).toBe('120px');
      expect(input.style.overflowY).toBe('auto');
      width = 400;
      act(() => notify());
      expect(input.style.height).toBe('24px');
      expect(input.style.overflowY).toBe('hidden');
      expect(input.value).toBe(value);
    }
    expect(measuredHeights.every(height => height === 'auto')).toBe(true);
    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('resizes external draft updates and ignores notifications caused only by height changes', () => {
    const { container, rerender } = render(<Composer value={'first\nsecond'} />);
    const input = container.querySelector('textarea')!;
    expect(input.style.height).toBe('48px');
    const measurements = measuredHeights.length;
    act(() => notify());
    expect(measuredHeights).toHaveLength(measurements);
    rerender(<Composer />);
    expect(input.style.height).toBe('24px');
  });

  it('waits for hidden fields to become measurable and remeasures typography changes', async () => {
    width = 0;
    const { container } = render(<Composer />);
    const input = container.querySelector('textarea')!;
    expect(input.style.height).toBe('');
    width = 100;
    act(() => notify());
    expect(input.style.height).toBe('120px');
    width = 400;
    await act(async () => { document.documentElement.style.setProperty('--test-font', '15px'); });
    expect(input.style.height).toBe('24px');
    document.documentElement.style.removeProperty('--test-font');
  });
});
