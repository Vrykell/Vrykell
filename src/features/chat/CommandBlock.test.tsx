import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
invokeMock.mockResolvedValue(undefined);
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

import Markdown from '@features/chat/components/Markdown';
import { useTerminalStore } from '@features/terminal/stores/terminal';
import { useInputStore } from '@features/terminal/stores/input';
import { useSessionStore } from '@features/workspace';

describe('CommandBlock', () => {
  beforeEach(() => {
    invokeMock.mockClear();
    useInputStore.setState({ byPane: {} });
    // 模拟启动后存在活跃标签（store 不再内置初始标签）
    useSessionStore.getState().addTab({});
    const tabId = useSessionStore.getState().activeId;
    useTerminalStore.setState({ sessions: { [`${tabId}#0`]: 's1' }, dims: {}, visible: true });
  });

  it('bash 代码块带运行按钮，点击写入终端', () => {
    render(<Markdown content={'```bash\nls -la\n```'} />);
    fireEvent.click(screen.getByText('在终端运行'));
    expect(invokeMock).toHaveBeenCalledWith('pty_write', { id: 's1', data: 'ls -la\n' });
  });

  it('uses an explicit target for conversation code blocks after focus changes', () => {
    useTerminalStore.setState({ sessions: { selected: 'selected-pty', focused: 'focused-pty' }, focusedPaneId: 'focused' });
    render(<Markdown content={'```bash\necho selected\n```'} paneId="selected" />);
    fireEvent.click(screen.getByText('在终端运行'));
    expect(invokeMock).toHaveBeenCalledWith('pty_write', { id: 'selected-pty', data: 'echo selected\n' });
  });

  it('offers copy without terminal execution for a discussion-only conversation', () => {
    render(<Markdown content={'```bash\necho selected\n```'} paneId={null} />);
    expect(screen.queryByText('在终端运行')).not.toBeInTheDocument();
    expect(screen.getByTestId('code-copy-btn')).toBeInTheDocument();
  });

  it('stages a multiline script in its selected terminal without writing to either PTY', () => {
    useTerminalStore.setState({ sessions: { selected: 'selected-pty', focused: 'focused-pty' }, focusedPaneId: 'focused' });
    useInputStore.getState().setText('focused', 'unrelated draft');
    render(<Markdown content={'```bash\ncat <<\'END\' > sample.txt\nscript line\nEND\necho done\n```'} paneId="selected" />);
    fireEvent.click(screen.getByText('在终端运行'));
    expect(invokeMock.mock.calls.filter(call => call[0] === 'pty_write')).toEqual([]);
    expect(useInputStore.getState().byPane.selected?.text).toBe("cat <<'END' > sample.txt\nscript line\nEND\necho done");
    expect(useInputStore.getState().byPane.focused?.text).toBe('unrelated draft');
    expect(useTerminalStore.getState().focusedPaneId).toBe('selected');
  });

  it('python 代码块没有运行按钮', () => {
    render(<Markdown content={'```python\nprint(1)\n```'} />);
    expect(screen.queryByText('在终端运行')).toBeNull();
  });

  it('labels an untyped code block and copies its literal text', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<Markdown content={'```\n17:32:10  400\n```'} />);
    expect(screen.getByText('code')).toBeInTheDocument();
    expect(screen.queryByText('在终端运行')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('code-copy-btn'));
    expect(writeText).toHaveBeenCalledWith('17:32:10  400\n');
    await screen.findByText('已复制');
  });

  it('代码块带复制按钮，点击复制内容并切换为已复制', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    render(<Markdown content={'```python\nprint("hi")\n```'} />);
    fireEvent.click(screen.getByTestId('code-copy-btn'));
    expect(writeText).toHaveBeenCalledWith('print("hi")\n');
    await screen.findByText('已复制');
  });
});
