import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { useSessionStore } from '@features/workspace';
import { leaf } from '@features/workspace/model/windowLayout';
import { useTerminalStore } from '@features/terminal';
import PanelChat from '../components/PanelChat';

const sessionSnapshot = useSessionStore.getState();
const terminalSnapshot = useTerminalStore.getState();
const paneId = 'chat-tab#0';

beforeEach(() => {
  useSessionStore.setState({
    tabs: [{ id: 'chat-tab', title: 'Chat', kind: 'session',
      layout: leaf({ id: paneId, kind: 'local', shellType: 'bash', cwd: '/work' }) }],
    activeId: 'chat-tab', terminalCwds: {},
  });
  useTerminalStore.setState({ focusedPaneId: paneId, sessions: { [paneId]: 'pty-chat' } });
});
afterEach(() => {
  cleanup();
  useSessionStore.setState(sessionSnapshot, true);
  useTerminalStore.setState(terminalSnapshot, true);
});

it('uses spacing instead of decorative dots while retaining the connection indicator and controls', () => {
  const { container } = render(<PanelChat />);
  const status = container.querySelector<HTMLElement>('.chat-input-status')!;
  expect(status).not.toHaveTextContent('·');
  expect(status).toHaveTextContent('Bash');
  expect(status.querySelectorAll('.terminal-chip')).toHaveLength(2);
  expect(status.style.gap).toBe('6px');
  expect(status.querySelector('.terminal-chip > span[style]')).not.toBeNull();
  expect(screen.getByRole('button', { name: '添加附件' })).toBeInTheDocument();
  expect(screen.getByTestId('permission-mode-button')).toBeInTheDocument();
});

it('omits the directory chip without leaving a separator when the pane has no cwd', () => {
  useSessionStore.setState({ tabs: [{ id: 'chat-tab', title: 'Chat', kind: 'session',
    layout: leaf({ id: paneId, kind: 'local', shellType: 'bash' }) }] });
  const { container } = render(<PanelChat />);
  const status = container.querySelector('.chat-input-status')!;
  expect(status.querySelectorAll('.terminal-chip')).toHaveLength(1);
  expect(status).not.toHaveTextContent('·');
});
