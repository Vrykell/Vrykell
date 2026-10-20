import { useState, type RefObject } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PinnedCommand from '../components/PinnedCommand';
import type { TermBlock } from '../services/pipeline/termBlock';
import { useTypographyStore } from '@config/typography';
import { useTerminalStore } from '../stores/terminal';

const { write } = vi.hoisted(() => ({ write: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@platform/pty', async importOriginal => ({ ...await importOriginal<typeof import('@platform/pty')>(), ptyWrite: write }));
const terminalSnapshot = useTerminalStore.getState();

const block: TermBlock = {
  id: 'one', command: 'ls -la', cwd: '/work', status: 'done', exitCode: 0,
  startedAt: 1000, endedAt: 1200, wasLongRunning: false, linesTruncated: 0,
  outputHtml: '', outputRaw: '', outputText: 'result',
};

function Header({ block: item = block, scrollRef }: { block?: TermBlock; scrollRef?: RefObject<HTMLDivElement | null> }) {
  const [collapsed, setCollapsed] = useState(false);
  return <PinnedCommand block={item} paneId="pane" remaining={500} insetLeft={8} insetRight={8}
    scrollRef={scrollRef} collapsed={collapsed} onToggle={() => setCollapsed(value => !value)} />;
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  write.mockClear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  useTypographyStore.setState({ commandHighlighting: false });
  useTerminalStore.setState(terminalSnapshot, true);
});

describe('pinned command presentation', () => {
  it('keeps context visible and hides only the viewport header', () => {
    const { rerender } = render(<Header />);
    expect(screen.getByRole('region')).toHaveTextContent('/work');
    expect(screen.getByRole('region')).toHaveTextContent('(0.200s)');
    expect(screen.getByRole('region')).toHaveTextContent('ls -la');
    fireEvent.click(screen.getByRole('button', { name: '收起命令标题' }));
    expect(screen.getByTestId('pinned-command')).toHaveAttribute('data-collapsed', 'true');
    expect(screen.queryByText('ls -la')).toBeNull();
    rerender(<Header block={{ ...block, id: 'two', command: 'pwd' }} />);
    expect(screen.getByTestId('pinned-command')).toHaveAttribute('data-collapsed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '显示命令标题' }));
    expect(screen.getByRole('region')).toHaveTextContent('pwd');
  });

  it('opens the existing command actions for the viewed block', () => {
    render(<Header />);
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
    const { rerender } = render(<Header block={running} />);
    expect(screen.getByRole('region')).toHaveTextContent('(1.000s)');
    expect(screen.getByRole('region').querySelector('[data-kind="command"]')).toHaveTextContent('ls');
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByRole('region')).toHaveTextContent('(2.000s)');
    rerender(<Header />);
    expect(screen.getByRole('region')).toHaveTextContent('(0.200s)');
  });

  it('retains running controls when completed titles are collapsed and interrupts the owning pane', async () => {
    useTerminalStore.setState({ sessions: { pane: 'pinned-session', other: 'unrelated-session' }, focusedPaneId: 'other' });
    render(<PinnedCommand block={{ ...block, status: 'executing', endedAt: null, exitCode: null }} paneId="pane"
      remaining={500} insetLeft={8} insetRight={8} collapsed onToggle={vi.fn()} />);
    expect(screen.getByTestId('pinned-command')).toHaveAttribute('data-collapsed', 'true');
    expect(screen.getByRole('region')).not.toHaveTextContent(block.command);
    expect(screen.getByRole('region')).not.toHaveTextContent(block.cwd!);
    expect(screen.getByRole('button', { name: '重绘终端' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '结束前台应用' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '进入全屏交互' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '显示命令标题' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '终止命令' }));
    await vi.waitFor(() => expect(write).toHaveBeenCalledExactlyOnceWith('pinned-session', '\x03'));
  });

  it('keeps collapse and the same header element across running and completed block changes', () => {
    const { rerender } = render(<Header />);
    const element = screen.getByTestId('pinned-command');
    fireEvent.click(screen.getByRole('button', { name: '收起命令标题' }));
    for (const status of ['executing', 'done', 'executing'] as const) {
      rerender(<Header block={{ ...block, id: status, status, command: `hidden-${status}` }} />);
      expect(screen.getByTestId('pinned-command')).toBe(element);
      expect(element).toHaveAttribute('data-collapsed', 'true');
      expect(element).not.toHaveTextContent(`hidden-${status}`);
    }
  });

  it('routes wheel scrolling through the history host instead of trapping it in the title', () => {
    const scroll = document.createElement('div');
    scroll.scrollTop = 200;
    scroll.style.lineHeight = '16px';
    const wheel = vi.fn();
    scroll.addEventListener('wheel', wheel);
    const { unmount } = render(<Header scrollRef={{ current: scroll }} />);
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
