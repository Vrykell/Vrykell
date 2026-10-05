import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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

  it('头部行内显示退出码与耗时；不再显示 cwd/git 上下文行', () => {
    useBlockStore.getState().setBlocks('t1', [
      block({ cwd: '/Users/w/work', gitBranch: 'master', startedAt: 1000, endedAt: 2400 }),
    ]);
    render(<TerminalBlockList tabId="t1" />);
    expect(screen.queryByText(/work/)).toBeNull();
    expect(screen.queryByText(/master/)).toBeNull();
    expect(screen.getByTestId('exit-code').textContent).toBe('0');
    expect(screen.getByText('(1.4s)')).toBeTruthy(); // fmtDuration(1400ms) = '1.4s'
  });

  it('失败命令退出码红色 ✗N', () => {
    useBlockStore.getState().setBlocks('t1', [block({ exitCode: 1 })]);
    render(<TerminalBlockList tabId="t1" />);
    expect(screen.getByTestId('exit-code').textContent).toBe('1');
  });

  it('命令行无 $ 前缀、无 3px 左边框', () => {
    useBlockStore.getState().setBlocks('t1', [block({})]);
    const { container } = render(<TerminalBlockList tabId="t1" />);
    expect(screen.queryByText('$')).toBeNull();
    expect(container.innerHTML).not.toContain('border-left: 3px');
  });

  it('已完成块操作按钮保持统一尺寸', () => {
    useBlockStore.getState().setBlocks('t1', [block({})]);
    render(<TerminalBlockList tabId="t1" />);
    fireEvent.mouseEnter(screen.getByTestId('command-block-b1'));

    for (const title of ['AI 解释', '重新运行', '复制命令', '复制输出', '更多操作']) {
      const button = screen.getByTitle(title);
      expect(button).toHaveStyle({ width: '28px', minWidth: '28px', height: '28px', padding: '0px' });
      expect(button.querySelector('svg')).toHaveStyle({ width: '16px', height: '16px' });
    }
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

  it('executing block 显示终止按钮与活终端挂载点（实时输出由 running-term xterm 承载）', () => {
    useBlockStore.getState().setBlocks('t1', [
      block({ status: 'executing', command: 'npm i', outputText: 'fetching…' }),
    ]);
    render(<TerminalBlockList tabId="t1" />);
    expect(screen.getByTitle('终止命令 (Ctrl+C)')).toBeTruthy();
    for (const name of [
      '终止命令 (Ctrl+C)',
      '结束前台应用（SIGTERM；3 秒内再点强杀 SIGKILL）',
      '进入全屏交互',
    ]) {
      const button = screen.getByRole('button', { name });
      expect(button.style.minWidth).toBe('28px');
      expect(button.style.height).toBe('28px');
      expect(button.querySelector('svg')).toHaveStyle({ width: '16px', height: '16px' });
      expect(button.textContent).toBe('');
    }
    // jsdom 下 getExecutingTerm 返回 null，只渲染宿主 div
    expect(screen.getByTestId('running-term')).toBeTruthy();
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
