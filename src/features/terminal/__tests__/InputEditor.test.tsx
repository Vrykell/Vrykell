import { cleanup, render, fireEvent, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import InputEditor from '../components/InputEditor';
import { useSessionStore } from '@features/workspace';
import { useTerminalStore } from '@features/terminal';

vi.mock('../hooks/useInputEditorController', () => ({
  useInputEditorController: () => ({
    inputRef: { current: null }, panelRef: { current: null }, text: '', aiMode: false,
    visible: true, isFocused: true, hasSession: true, terminalLabel: 'Bash',
    tabCwd: '/work', recentGitBranch: 'dev', ghost: '',
  }),
}));
const stores = [useSessionStore.getState(), useTerminalStore.getState()] as const;
afterEach(() => {
  cleanup();
  useSessionStore.setState(stores[0], true);
  useTerminalStore.setState(stores[1], true);
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

it('renders clickable chips as buttons and keeps the git branch chip a static span', () => {
  useTerminalStore.setState({ sessions: { pane: 'pty' } });
  useSessionStore.setState({ tabs: [{ id: 'tab', kind: 'session', title: 'Shell', layout: { type: 'leaf', terminal: { id: 'pane', kind: 'local', shellType: 'bash' } } }] });
  const { container } = render(<InputEditor paneId="pane" onSessionStatusClick={() => {}} />);
  const entry = screen.getByTestId('ssh-status-toggle');
  expect(entry.tagName).toBe('BUTTON');
  expect(entry).not.toBeDisabled();
  const directory = container.querySelector<HTMLButtonElement>('.directory-picker-trigger');
  expect(directory?.tagName).toBe('BUTTON');
  expect(directory).not.toBeDisabled();
  expect(container.querySelector('.terminal-branch')?.tagName).toBe('SPAN');
});
