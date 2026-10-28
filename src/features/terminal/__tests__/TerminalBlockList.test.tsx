import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import TerminalBlockList from '@features/terminal/components/TerminalBlockList';
import { useBlockStore } from '@features/terminal/stores/blocks';
import type { TermBlock } from '@features/terminal/services/pipeline/termBlock';

function block(patch: Partial<TermBlock>): TermBlock {
  return {
    id: 'b1', command: 'ls', status: 'done', exitCode: 0,
    startedAt: 1000, endedAt: 1040, wasLongRunning: false,
    outputHtml: '', outputText: 'file1\nfile2', outputRaw: '', linesTruncated: 0,
    ...patch,
  };
}

describe('TerminalBlockList', () => {
  it('renders empty submissions as normal directory blocks without output', () => {
    useBlockStore.getState().setBlocks('t1', [
      block({ id: 'empty-1', command: '', cwd: '/Users/test', outputText: '' }),
      block({ id: 'empty-2', command: '', cwd: '/Users/test', outputText: '' }),
    ]);
    render(<TerminalBlockList tabId="t1" />);
    for (const id of ['empty-1', 'empty-2']) {
      const item = screen.getByTestId(`command-block-${id}`);
      expect(item.querySelector('.command-block-cwd')).toHaveTextContent('/Users/test');
      expect(item.querySelector('.command-block-command')).toBeEmptyDOMElement();
      expect(item.querySelector('.command-block-output')).toBeNull();
    }
  });

  beforeEach(() => useBlockStore.setState({ byTab: {} }));

  it('puts context above the command and leaves only the more control in the block', () => {
    useBlockStore.getState().setBlocks('t1', [
      block({ cwd: '/Users/w/work', gitBranch: 'main', startedAt: 1000, endedAt: 2400 }),
    ]);
    render(<TerminalBlockList tabId="t1" />);
    const item = screen.getByTestId('command-block-b1');
    const context = item.querySelector('.command-block-info')!;
    expect(context).toHaveTextContent('/Users/w/work');
    expect(context).toHaveTextContent('main');
    expect(context).toHaveTextContent('(1.400s)');
    // The context row (path, branch, status) is selectable so it can be copied.
    expect(context).toHaveAttribute('data-selectable');
    expect(screen.getByTestId('exit-code')).toHaveTextContent('0');
    expect(item.querySelectorAll('button')).toHaveLength(1);
    expect(screen.getByLabelText('更多操作')).toHaveAttribute('aria-haspopup', 'menu');
  });

  it('marks failed commands without changing their content inset', () => {
    useBlockStore.getState().setBlocks('t1', [block({ exitCode: 1 })]);
    render(<TerminalBlockList tabId="t1" />);
    expect(screen.getByTestId('exit-code').textContent).toBe('1');
    expect(screen.getByTestId('command-block-b1')).toHaveAttribute('data-failed', 'true');
    expect(screen.getByTestId('command-block-b1')).toHaveStyle({ paddingLeft: '16px' });
  });

  it('the command line has no $ prefix and no 3px left border', () => {
    useBlockStore.getState().setBlocks('t1', [block({})]);
    const { container } = render(<TerminalBlockList tabId="t1" />);
    expect(screen.queryByText('$')).toBeNull();
    expect(container.innerHTML).not.toContain('border-left: 3px');
  });

  it('a command without output stays blank and keeps only the command header and exit code', () => {
    useBlockStore.getState().setBlocks('t1', [block({
      outputText: '', outputHtml: '', outputRaw: '\x1b[H\x1b[2J\x1b[K\r\n',
    })]);
    render(<TerminalBlockList tabId="t1" />);
    expect(screen.queryByText('命令未产生输出')).toBeNull();
    expect(screen.getByTestId('exit-code')).toHaveTextContent('0');
    // Header row and command line are both selectable (no output here).
    const selectable = screen.getByTestId('command-block-b1').querySelectorAll('[data-selectable]');
    expect(selectable).toHaveLength(2);
    expect([...selectable].some((el) => el.classList.contains('command-block-info'))).toBe(true);
    expect([...selectable].some((el) => el.classList.contains('command-block-command'))).toBe(true);
  });

  it('opens all four command actions in the more menu without collapse controls', async () => {
    useBlockStore.getState().setBlocks('t1', [block({})]);
    render(<TerminalBlockList tabId="t1" />);
    expect(screen.queryByLabelText('折叠')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('折叠全部')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    const menu = screen.getByRole('menu', { name: '命令块操作' });
    expect(menu).toHaveTextContent('重新运行');
    expect(menu).toHaveTextContent('发给 AI 分析');
    expect(menu).toHaveTextContent('复制命令');
    expect(menu).toHaveTextContent('复制输出');
    await waitFor(() => expect(screen.getByRole('menuitem', { name: '重新运行' })).toHaveFocus());
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem', { name: '发给 AI 分析' })).toHaveFocus();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByText(/file1/)).toBeInTheDocument();
  });

  it('always renders output even when a legacy record has a collapse flag', () => {
    useBlockStore.getState().setBlocks('t1', [{ ...block({}), ...{ collapsed: true } }]);
    render(<TerminalBlockList tabId="t1" />);
    expect(screen.getByText(/file1/)).toBeInTheDocument();
    expect(screen.queryByLabelText('展开')).not.toBeInTheDocument();
  });

  it('truncation hint: linesTruncated > 0 shows the truncated notice', () => {
    useBlockStore.getState().setBlocks('t1', [block({ linesTruncated: 42 })]);
    render(<TerminalBlockList tabId="t1" />);
    expect(screen.getByText(/已截断 42 行/)).toBeTruthy();
  });

  it('a pending block renders no placeholder card (the fixed bottom input bar is the prompt)', () => {
    useBlockStore.getState().setBlocks('t1', [
      block({ id: 'p1', status: 'pending', command: '', outputText: '', cwd: '/Users/w' }),
    ]);
    const { container } = render(<TerminalBlockList tabId="t1" />);
    // With only a pending block the whole list renders nothing
    expect(container.innerHTML).toBe('');
  });

  it('an empty done block (no command, no output, produced by pressing Enter) renders no empty card', () => {
    useBlockStore.getState().setBlocks('t1', [
      block({ id: 'e1', command: '', outputText: '', outputHtml: '', exitCode: null, startedAt: null }),
    ]);
    const { container } = render(<TerminalBlockList tabId="t1" />);
    expect(container.innerHTML).toBe('');
  });

  it('executing block displays controls and mounts live output for sustained commands', async () => {
    useBlockStore.getState().setBlocks('t1', [
      block({ status: 'executing', command: 'npm i', outputText: 'fetching…' }),
    ]);
    render(<TerminalBlockList tabId="t1" />);
    await waitFor(() => expect(screen.getByLabelText('终止命令')).toBeTruthy());
    for (const name of [
      '重绘终端',
      '终止命令',
      '结束前台应用',
      '进入全屏交互',
    ]) {
      const button = screen.getByRole('button', { name });
      expect(button).toHaveClass('icon-button');
      expect(button).toHaveAttribute('data-compact', 'true');
      expect(button.querySelector('svg')).toHaveStyle({ width: '16px', height: '16px' });
      expect(button.textContent).toBe('');
    }
    // Under jsdom getExecutingTerm returns null, so only the host div is rendered
    await waitFor(() => expect(screen.getByTestId('running-term')).toBeTruthy());
    // The snapshot text must no longer appear in the executing block (it is not extracted before completion)
    expect(screen.queryByText(/fetching/)).toBeNull();
  });

  it('unstyled multiline outputHtml (no <span) renders as HTML without showing a literal <br>', () => {
    // Regression: extractSnapshotFromBuffer produces 'file1<br>file2' for unstyled multiline output,
    // and the old content sniffing (includes('<span')) misread it as plain text -> rendering a visible '&lt;br&gt;' literal.
    useBlockStore.getState().setBlocks('t1', [
      block({ outputHtml: 'file1<br>file2', outputText: 'file1\nfile2' }),
    ]);
    const { container } = render(<TerminalBlockList tabId="t1" />);
    expect(container.innerHTML).toContain('file1<br>file2');
    expect(container.innerHTML).not.toContain('&lt;br&gt;');
    expect(screen.getByText(/file1/).textContent).not.toContain('<br>');
  });
});

it('publishes a short command directly without a temporary running header', async () => {
  useBlockStore.getState().setBlocks('t1', [block({ id: 'fast', status: 'executing', exitCode: null, endedAt: null })]);
  render(<TerminalBlockList tabId="t1" />);
  expect(screen.queryByTestId('running-block-fast')).toBeNull();
  const { act } = await import('@testing-library/react');
  act(() => useBlockStore.getState().setBlocks('t1', [block({ id: 'fast' })]));
  expect(screen.getByTestId('command-block-fast')).toHaveTextContent('file1');
  expect(screen.queryByTestId('running-block-fast')).toBeNull();
});
