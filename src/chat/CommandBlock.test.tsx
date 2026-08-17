import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
invokeMock.mockResolvedValue(undefined);
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

import Markdown from './Markdown';
import { useTerminalStore } from '../stores/terminal';
import { useWorkspaceStore } from '../stores/workspace';

describe('CommandBlock', () => {
  beforeEach(() => {
    invokeMock.mockClear();
    const tabId = useWorkspaceStore.getState().activeId;
    useTerminalStore.setState({ sessions: { [tabId]: 's1' }, dims: {}, visible: true });
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
});
