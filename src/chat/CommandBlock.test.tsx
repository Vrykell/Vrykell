import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
invokeMock.mockResolvedValue(undefined);
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

import Markdown from '@/chat/Markdown';
import { useTerminalStore } from '@/stores/terminal';
import { useWorkspaceStore } from '@/stores/workspace';

describe('CommandBlock', () => {
  beforeEach(() => {
    invokeMock.mockClear();
    // 模拟启动后存在活跃标签（store 不再内置初始标签）
    useWorkspaceStore.getState().addTab({});
    const tabId = useWorkspaceStore.getState().activeId;
    useTerminalStore.setState({ sessions: { [`${tabId}#0`]: 's1' }, dims: {}, visible: true });
  });

  it('bash 代码块带运行按钮，点击写入终端', () => {
    render(<Markdown content={'```bash\nls -la\n```'} />);
    fireEvent.click(screen.getByText('在终端运行'));
    expect(invokeMock).toHaveBeenCalledWith('pty_write', { id: 's1', data: 'ls -la\n' });
  });

  it('python 代码块没有运行按钮', () => {
    render(<Markdown content={'```python\nprint(1)\n```'} />);
    expect(screen.queryByText('在终端运行')).toBeNull();
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
