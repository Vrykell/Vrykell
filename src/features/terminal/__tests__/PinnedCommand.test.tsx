import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PinnedCommand from '../components/PinnedCommand';
import type { TermBlock } from '../services/pipeline/termBlock';
import { useTypographyStore } from '@config/typography';

const block: TermBlock = {
  id: 'one', command: 'ls -la', cwd: '/work', status: 'done', exitCode: 0,
  startedAt: 1000, endedAt: 1200, wasLongRunning: false, linesTruncated: 0,
  outputHtml: '', outputRaw: '', outputText: 'result',
};

beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  useTypographyStore.setState({ commandHighlighting: false });
});

describe('pinned command presentation', () => {
  it('keeps context visible and hides only the viewport header', () => {
    render(<PinnedCommand block={block} paneId="pane" remaining={500} insetLeft={8} insetRight={8} />);
    expect(screen.getByRole('region')).toHaveTextContent('/work');
    expect(screen.getByRole('region')).toHaveTextContent('(0.200s)');
    expect(screen.getByRole('region')).toHaveTextContent('ls -la');
    fireEvent.click(screen.getByRole('button', { name: '收起命令标题' }));
    expect(screen.getByTestId('pinned-command')).toHaveAttribute('data-collapsed', 'true');
    expect(screen.queryByText('ls -la')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '显示命令标题' }));
    expect(screen.getByRole('region')).toHaveTextContent('ls -la');
  });

  it('opens the existing command actions for the viewed block', () => {
    render(<PinnedCommand block={block} paneId="pane" remaining={500} insetLeft={8} insetRight={8} />);
    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    expect(screen.getByRole('menu', { name: '命令块操作' })).toHaveTextContent('复制输出');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('region')).toHaveTextContent('/work');
  });

  it('updates a running duration and shares optional syntax colors', () => {
    vi.useFakeTimers();
    vi.setSystemTime(2000);
    useTypographyStore.setState({ commandHighlighting: true });
    const running = { ...block, endedAt: null, status: 'executing' as const, exitCode: null };
    const { rerender } = render(<PinnedCommand block={running} paneId="pane" remaining={500} insetLeft={8} insetRight={8} />);
    expect(screen.getByRole('region')).toHaveTextContent('(1.000s)');
    expect(screen.getByRole('region').querySelector('[data-kind="command"]')).toHaveTextContent('ls');
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByRole('region')).toHaveTextContent('(2.000s)');
    rerender(<PinnedCommand block={block} paneId="pane" remaining={500} insetLeft={8} insetRight={8} />);
    expect(screen.getByRole('region')).toHaveTextContent('(0.200s)');
  });

  it('routes wheel scrolling through the history host instead of trapping it in the title', () => {
    const scroll = document.createElement('div');
    scroll.scrollTop = 200;
    scroll.style.lineHeight = '16px';
    const wheel = vi.fn();
    scroll.addEventListener('wheel', wheel);
    const { unmount } = render(<PinnedCommand block={block} paneId="pane" remaining={500}
      insetLeft={8} insetRight={8} scrollRef={{ current: scroll }} />);
    const title = screen.getByRole('region');
    fireEvent.wheel(title, { deltaY: -40 });
    expect(scroll.scrollTop).toBe(160);
    expect(wheel).toHaveBeenCalledTimes(1);
    fireEvent.wheel(title, { deltaY: 2, deltaMode: WheelEvent.DOM_DELTA_LINE });
    expect(scroll.scrollTop).toBe(192);
    unmount();
    fireEvent.wheel(title, { deltaY: 10 });
    expect(scroll.scrollTop).toBe(192);
  });
});
