import { cleanup, render, fireEvent, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import InputEditor from '../components/InputEditor';

vi.mock('../hooks/useInputEditorController', () => ({
  useInputEditorController: () => ({
    inputRef: { current: null }, panelRef: { current: null }, text: '', aiMode: false,
    visible: true, isFocused: true, hasSession: true, terminalLabel: 'Bash',
    tabCwd: '/work', recentGitBranch: 'dev', ghost: '',
  }),
}));
vi.mock('../components/DirectoryPicker', () => ({
  default: () => <span className="terminal-chip terminal-directory">/work</span>,
}));
afterEach(cleanup);

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
