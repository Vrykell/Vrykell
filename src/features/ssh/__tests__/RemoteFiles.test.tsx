import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import type FilePanel from '@features/files/components/FilePanel';

const mocks = vi.hoisted(() => ({ write: vi.fn(), toast: vi.fn(), focus: vi.fn(), debug: vi.fn() }));
vi.mock('@platform/pty', () => ({ ptyWrite: mocks.write }));
vi.mock('@ui/Toast', () => ({ useToastStore: { getState: () => ({ addToast: mocks.toast }) } }));
vi.mock('@features/terminal/services/terminalDebug', () => ({ terminalDebug: mocks.debug }));
vi.mock('@features/terminal/services/terminalClipboard', () => ({ getPaneTerminal: (id: string) => ({ focus: () => mocks.focus(id) }) }));
vi.mock('@features/files/model/fileOps', () => ({ fileOpsFor: () => ({}) }));
vi.mock('@features/files/components/FilePanel', () => ({
  default: (props: ComponentProps<typeof FilePanel>) => <>
    <button onClick={() => props.openEntry?.({ name: 'config.txt', path: '/home/test/config.txt', is_dir: false })}>Open remote file</button>
    <button onClick={() => props.onSyncToTerminal?.('/home/test')}>Sync directory</button>
  </>,
}));

import RemoteFiles from '@features/ssh/components/RemoteFiles';
import { useSessionStore } from '@features/workspace';
import { useTerminalStore } from '@features/terminal';
import { leaf } from '@features/workspace/model/windowLayout';

const conn = { id: 'ssh-1', name: 'server', host: 'server', user: 'test', authMethod: 'key' as const, password: '' };
const sshPane = (id: string, connectionId = 'ssh-1') => leaf({ id, kind: 'ssh', ssh: { name: 'server', host: 'server', connectionId } });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.write.mockResolvedValue(undefined);
  useSessionStore.setState({ activeId: 'tab', tabs: [{ id: 'tab', kind: 'session', title: 'SSH', layout: sshPane('tab#0') }] });
  useTerminalStore.setState({ focusedPaneId: 'tab#0', sessions: { 'tab#0': 'ssh-session' } });
});

describe('remote file terminal routing', () => {
  it('opens a remote file through the pane session rather than the tab id', async () => {
    render(<RemoteFiles conn={conn} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open remote file' }));
    await waitFor(() => expect(mocks.write).toHaveBeenCalledWith('ssh-session', expect.stringContaining("'/home/test/config.txt'")));
    expect(mocks.toast).not.toHaveBeenCalled();
    expect(mocks.focus).toHaveBeenCalledWith('tab#0');
    expect(mocks.debug).toHaveBeenCalledWith('remote-file-terminal-action', { action: 'edit', paneId: 'tab#0', tabId: 'tab', hasSession: true });
  });

  it('uses the focused matching split pane for file opening and directory sync', async () => {
    useSessionStore.setState({ tabs: [{ id: 'tab', kind: 'session', title: 'SSH', layout: { type: 'split', dir: 'row', ratio: 0.5, first: sshPane('tab#0'), second: sshPane('tab#1') } }] });
    useTerminalStore.setState({ focusedPaneId: 'tab#1', sessions: { 'tab#0': 'first', 'tab#1': 'second', tab: 'wrong-tab-session' } });
    render(<RemoteFiles conn={conn} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open remote file' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sync directory' }));
    await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(2));
    expect(mocks.write.mock.calls.every(([session]) => session === 'second')).toBe(true);
  });

  it('resolves the active tab at action time instead of retaining its previous pane', async () => {
    render(<RemoteFiles conn={conn} />);
    useSessionStore.setState({ activeId: 'other', tabs: [{ id: 'other', kind: 'session', title: 'SSH', layout: sshPane('other#0') }] });
    useTerminalStore.setState({ focusedPaneId: 'other#0', sessions: { 'other#0': 'other-session' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sync directory' }));
    await waitFor(() => expect(mocks.write).toHaveBeenCalledWith('other-session', "cd '/home/test'\r"));
  });

  it('does not write a remote command into an unrelated local pane', () => {
    useSessionStore.setState({ tabs: [{ id: 'tab', kind: 'session', title: 'Local', layout: leaf({ id: 'tab#0', kind: 'local' }) }] });
    render(<RemoteFiles conn={conn} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open remote file' }));
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith('SSH 会话未就绪', 'info');
  });

  it('reports a write failure instead of swallowing it', async () => {
    mocks.write.mockRejectedValue(new Error('Session closed'));
    render(<RemoteFiles conn={conn} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open remote file' }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('Session closed', 'error'));
    expect(mocks.focus).not.toHaveBeenCalled();
  });
});
