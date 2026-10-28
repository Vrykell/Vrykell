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
    // Simulate an active tab after startup (the store no longer seeds an initial tab)
    useSessionStore.getState().addTab({});
    const tabId = useSessionStore.getState().activeId;
    useTerminalStore.setState({ sessions: { [`${tabId}#0`]: 's1' }, dims: {}, visible: true });
  });

  it('bash code block has a run button that writes to the terminal when clicked', () => {
    render(<Markdown content={'```bash\nls -la\n```'} />);
    const action = screen.getByRole('button', { name: '在终端运行' });
    expect(action.querySelector('svg rect')).not.toBeNull();
    expect(action.querySelector('svg text')).toBeNull();
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

  it('python code block has no run button', () => {
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

  it('code block has a copy button that copies the content and switches to copied', async () => {
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

  it('keeps a code block mounted while its streamed code grows', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const view = render(<Markdown content={'```python\nprint(1)\n```'} />);
    fireEvent.click(screen.getByTestId('code-copy-btn'));
    await screen.findByText('已复制');
    view.rerender(<Markdown content={'```python\nprint(1)\nprint(2)\n```\n\nMore answer text'} />);
    expect(screen.getByTestId('code-copy-btn')).toHaveTextContent('已复制');
  });
});
