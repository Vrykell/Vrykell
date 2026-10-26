import { cleanup, render, fireEvent, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import InputEditor from '../components/InputEditor';
import { useSessionStore } from '@features/workspace';
import { useTerminalStore } from '@features/terminal';
import { useTypographyStore } from '@config/typography';

const controller = vi.hoisted(() => ({ setText: null as null | ((value: string) => void) }));

vi.mock('../hooks/useInputEditorController', () => ({
  useInputEditorController: () => {
    const [text, setText] = useState('');
    const inputRef = useRef<HTMLTextAreaElement>(null);
    controller.setText = setText;
    return {
      inputRef, panelRef: useRef(null), text, aiMode: false,
      visible: true, isFocused: true, hasSession: true, terminalLabel: 'Bash',
      tabCwd: '/work', recentGitBranch: 'dev', ghost: '',
      handleChange: (event: { target: { value: string } }) => setText(event.target.value),
    };
  },
}));
const stores = [useSessionStore.getState(), useTerminalStore.getState()] as const;
afterEach(() => {
  cleanup();
  useSessionStore.setState(stores[0], true);
  useTerminalStore.setState(stores[1], true);
  useTypographyStore.setState({ commandHighlighting: false });
});

it('uses the existing host chip as the status entry without adding a separate icon button', () => {
  const open = vi.fn();
  const { container } = render(<InputEditor paneId="pane" onSessionStatusClick={open} />);
  const entry = screen.getByTestId('ssh-status-toggle');
  expect(entry).toHaveTextContent('Bash');
  expect(entry).toHaveClass('terminal-chip');
  expect(entry).toHaveAttribute('data-tip', '查看 SSH 连接状态与资源');
  expect(container.querySelectorAll('.terminal-input-status .terminal-chip')).toHaveLength(3);
  fireEvent.click(entry);
  expect(open).toHaveBeenCalledOnce();
});

it('separates shell, directory and branch chips with spacing instead of dots', () => {
  const { container } = render(<InputEditor paneId="pane" />);
  const status = container.querySelector<HTMLElement>('.terminal-input-status')!;
  expect(status).not.toHaveTextContent('·');
  expect(status.querySelectorAll('.terminal-chip')).toHaveLength(3);
  expect(status.style.gap).toBe('6px');
  expect(status.querySelector('.terminal-chip > span[style]')).not.toBeNull();
});

it('renders directory and branch chips as interactive buttons', () => {
  useTerminalStore.setState({ sessions: { pane: 'pty' } });
  useSessionStore.setState({ tabs: [{ id: 'tab', kind: 'session', title: 'Shell', layout: { type: 'leaf', terminal: { id: 'pane', kind: 'local', shellType: 'bash' } } }] });
  const { container } = render(<InputEditor paneId="pane" onSessionStatusClick={() => {}} />);
  const entry = screen.getByTestId('ssh-status-toggle');
  expect(entry.tagName).toBe('BUTTON');
  expect(entry).not.toBeDisabled();
  const directory = container.querySelector<HTMLButtonElement>('.directory-picker-trigger');
  expect(directory?.tagName).toBe('BUTTON');
  expect(directory).not.toBeDisabled();
  expect(container.querySelector('.terminal-branch')?.tagName).toBe('BUTTON');
  expect(container.querySelector('.terminal-branch')).toHaveAttribute('aria-haspopup', 'menu');
});

it('re-syncs the colored mirror after content changes when the input is scrolled', () => {
  useTypographyStore.setState({ commandHighlighting: true });
  render(<InputEditor paneId="pane" />);
  const input = screen.getByPlaceholderText(/输入命令/) as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: 'line one\nline two' } });
  const overlay = document.querySelector<HTMLElement>('.command-input-overlay')!;
  // A capped height keeps the offset while the caret stays on the visible last line, so the
  // next edit fires no scroll event: the mirror has to be re-synced by the component itself.
  input.scrollTop = 30;
  fireEvent.change(input, { target: { value: 'line one\nline two\nline three' } });
  expect(overlay.scrollTop).toBe(30);
});

it('marks the transparent input so selected text does not double the colored mirror', () => {
  useTypographyStore.setState({ commandHighlighting: true });
  render(<InputEditor paneId="pane" />);
  const input = screen.getByPlaceholderText(/输入命令/);
  fireEvent.change(input, { target: { value: 'Get-ChildItem' } });
  expect(input).toHaveClass('command-input-highlighted');
  fireEvent.change(input, { target: { value: '' } });
  expect(input).not.toHaveClass('command-input-highlighted');
});

it('reserves the caret line after a trailing newline in the colored mirror', () => {
  useTypographyStore.setState({ commandHighlighting: true });
  render(<InputEditor paneId="pane" />);
  const input = screen.getByPlaceholderText(/输入命令/);
  fireEvent.change(input, { target: { value: 'line\n' } });
  const overlay = document.querySelector<HTMLElement>('.command-input-overlay')!;
  // `pre-wrap` drops the trailing newline's line box; the zero-width space restores it so the
  // mirror keeps the same scroll height as the textarea.
  expect(overlay.textContent).toBe('line\n\u200b');
});
