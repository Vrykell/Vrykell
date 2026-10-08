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

  it('命令行无 $ 前缀、无 3px 左边框', () => {
    useBlockStore.getState().setBlocks('t1', [block({})]);
    const { container } = render(<TerminalBlockList tabId="t1" />);
    expect(screen.queryByText('$')).toBeNull();
    expect(container.innerHTML).not.toContain('border-left: 3px');
  });

  it('命令没有输出时保持空白，仅保留命令头部和退出码', () => {
    useBlockStore.getState().setBlocks('t1', [block({
      outputText: '', outputHtml: '', outputRaw: '\x1b[H\x1b[2J\x1b[K\r\n',
    })]);
    render(<TerminalBlockList tabId="t1" />);
    expect(screen.queryByText('命令未产生输出')).toBeNull();
    expect(screen.getByTestId('exit-code')).toHaveTextContent('0');
    expect(screen.getByTestId('command-block-b1').querySelectorAll('[data-selectable]')).toHaveLength(1);
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

  it('截断提示：linesTruncated > 0 显示已截断', () => {
    useBlockStore.getState().setBlocks('t1', [block({ linesTruncated: 42 })]);
    render(<TerminalBlockList tabId="t1" />);
    expect(screen.getByText(/已截断 42 行/)).toBeTruthy();
  });

  it('pending block 不渲染占位卡片（底部固定输入栏即提示符）', () => {
    useBlockStore.getState().setBlocks('t1', [
      block({ id: 'p1', status: 'pending', command: '', outputText: '', cwd: '/Users/w' }),
    ]);
    const { container } = render(<TerminalBlockList tabId="t1" />);
    // 唯一 pending 块时整个列表不渲染任何内容
    expect(container.innerHTML).toBe('');
  });

  it('空 done block（无命令无输出，连按回车产生）不渲染空卡片', () => {
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
    // jsdom 下 getExecutingTerm 返回 null，只渲染宿主 div
    await waitFor(() => expect(screen.getByTestId('running-term')).toBeTruthy());
    // 快照文本不应再出现在 executing 块中（完成前不提取）
    expect(screen.queryByText(/fetching/)).toBeNull();
  });

  it('无样式多行 outputHtml（无 <span）按 HTML 渲染，不显示字面 <br>', () => {
    // 回归：extractSnapshotFromBuffer 对无样式多行输出产出 'file1<br>file2'，
    // 旧的内容嗅探（includes('<span')）会误判为纯文本 → 渲染出可见 '&lt;br&gt;' 乱码。
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
