import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import type FilePanel from '@features/files/components/FilePanel';

const mocks = vi.hoisted(() => ({ write: vi.fn(), toast: vi.fn(), focus: vi.fn(), debug: vi.fn(), upload: vi.fn(), download: vi.fn(), open: vi.fn() }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: mocks.open }));
vi.mock('@platform/pty', () => ({ ptyWrite: mocks.write }));
vi.mock('@ui/feedback/Toast', () => ({ useToastStore: { getState: () => ({ addToast: mocks.toast }) } }));
vi.mock('@features/terminal/services/terminalDebug', () => ({ terminalDebug: mocks.debug }));
vi.mock('@features/terminal/services/terminalClipboard', () => ({ getPaneTerminal: (id: string) => ({ focus: () => mocks.focus(id) }) }));
vi.mock('@features/files/model/fileOps', () => ({ fileOpsFor: () => ({ upload: mocks.upload, download: mocks.download }) }));
vi.mock('@features/files/components/FilePanel', () => ({
  default: (props: ComponentProps<typeof FilePanel>) => <>
    <button onClick={() => props.openEntry?.({ name: 'config.txt', path: '/home/test/config.txt', is_dir: false })}>Open remote file</button>
    <button onClick={() => props.handlers?.onOpenEditor?.({ name: 'config.txt', path: '/home/test/config.txt', is_dir: false })}>Open remote file from menu</button>
    <button onClick={() => props.onSyncToTerminal?.('/home/test')}>Sync directory</button>
    <button onClick={() => props.onExternalDrop?.(['/local/item.zip'], { rowPath: null, dir: '/home/test' })}>Drop upload</button>
    <button onClick={() => props.handlers?.onUpload?.('file')}>Upload files</button>
    <button onClick={() => props.handlers?.onUpload?.('dir')}>Upload folder</button>
    <button onClick={() => props.handlers?.onDownload?.([{ name: 'item.zip', path: '/home/test/item.zip', is_dir: false }])}>Download item</button>
    <button onClick={() => props.handlers?.onDownload?.([{ name: 'folder', path: '/home/test/folder', is_dir: true }])}>Download folder</button>
    <button onClick={() => void props.prepareNativeDrag?.([{ name: 'drag.zip', path: '/home/test/drag.zip', is_dir: false }])}>Drag download</button>
  </>,
}));

import RemoteFiles from '@features/ssh/components/RemoteFiles';
import { useSessionStore } from '@features/workspace';
import { useTerminalStore } from '@features/terminal';
import { leaf } from '@features/workspace/model/windowLayout';
import { useEditorPreferences } from '@config/editor';
import { useRemotePathStore } from '@features/ssh/utils/remotePath';

const conn = { id: 'ssh-1', name: 'server', host: 'server', user: 'test', authMethod: 'key' as const, password: '' };
const sshPane = (id: string, connectionId = 'ssh-1') => leaf({ id, kind: 'ssh', ssh: { name: 'server', host: 'server', connectionId } });

it('opens remote text with the built-in editor when selected', () => {
  useEditorPreferences.setState({ remoteOpenMode: 'editor' });
  const open = vi.spyOn(useSessionStore.getState(), 'openEditorFile').mockReturnValue('editor');
  render(<RemoteFiles conn={conn} />); fireEvent.click(screen.getByRole('button', { name: 'Open remote file' }));
  expect(open).toHaveBeenCalledWith({ path: '/home/test/config.txt', connectionId: conn.id });
  expect(mocks.write).not.toHaveBeenCalled();
});

it('routes the row menu open action through the same preferred editor', () => {
  useEditorPreferences.setState({ remoteOpenMode: 'editor' });
  const open = vi.spyOn(useSessionStore.getState(), 'openEditorFile').mockReturnValue('editor');
  render(<RemoteFiles conn={conn} />); fireEvent.click(screen.getByRole('button', { name: 'Open remote file from menu' }));
  expect(open).toHaveBeenCalledWith({ path: '/home/test/config.txt', connectionId: conn.id });
  expect(mocks.write).not.toHaveBeenCalled();
});

beforeEach(() => {
  useEditorPreferences.setState({ remoteOpenMode: 'terminal' });
  vi.clearAllMocks();
  mocks.write.mockResolvedValue(undefined);
  mocks.upload.mockResolvedValue(undefined);
  mocks.download.mockResolvedValue('/Downloads/item.zip');
  mocks.open.mockReset().mockResolvedValue(null);
  useRemotePathStore.setState({ path: { 'ssh-1': '/home/test' } });
  useSessionStore.setState({ activeId: 'tab', tabs: [{ id: 'tab', kind: 'session', title: 'SSH', layout: sshPane('tab#0') }] });
  useTerminalStore.setState({ focusedPaneId: 'tab#0', sessions: { 'tab#0': 'ssh-session' } });
});

describe('remote file terminal routing', () => {
  it('opens the upload manager immediately for dropped files', async () => {
    mocks.upload.mockReturnValue(new Promise(() => {}));
    render(<RemoteFiles conn={conn} />);
    fireEvent.click(screen.getByRole('button', { name: 'Drop upload' }));
    expect(await screen.findByRole('button', { name: '返回文件浏览' })).toBeVisible();
    expect(mocks.upload).toHaveBeenCalledExactlyOnceWith('/home/test', '/local/item.zip');
  });

  it.each(['file', 'dir'] as const)('uploads each selected %s once through the picker', async kind => {
    const paths = kind === 'dir' ? ['/local/folder'] : ['/local/first.txt', '/local/second.txt'];
    mocks.open.mockResolvedValue(kind === 'dir' ? paths[0] : paths);
    render(<RemoteFiles conn={conn} />);
    fireEvent.click(screen.getByRole('button', { name: kind === 'dir' ? 'Upload folder' : 'Upload files' }));
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(paths.length));
    paths.forEach((path, index) => expect(mocks.upload).toHaveBeenNthCalledWith(index + 1, '/home/test', path));
    expect(mocks.open).toHaveBeenCalledOnce();
  });

  it.each(['Download item', 'Download folder', 'Drag download'])('downloads once for %s', async action => {
    render(<RemoteFiles conn={conn} />);
    fireEvent.click(screen.getByRole('button', { name: action }));
    await waitFor(() => expect(mocks.download).toHaveBeenCalledOnce());
    expect(mocks.download).toHaveBeenCalledWith(action === 'Download folder' ? '/home/test/folder' : action === 'Drag download' ? '/home/test/drag.zip' : '/home/test/item.zip');
  });

  it('opens the download manager for menu and native drag downloads', async () => {
    mocks.download.mockReturnValue(new Promise(() => {}));
    const view = render(<RemoteFiles conn={conn} />);
    fireEvent.click(screen.getByRole('button', { name: 'Download item' }));
    expect(await screen.findByRole('button', { name: '返回文件浏览' })).toBeVisible();
    view.unmount();
    render(<RemoteFiles conn={conn} />);
    fireEvent.click(screen.getByRole('button', { name: 'Drag download' }));
    expect(await screen.findByRole('button', { name: '返回文件浏览' })).toBeVisible();
  });

  it('opens a remote file through the pane session rather than the tab id', async () => {
    render(<RemoteFiles conn={conn} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open remote file' }));
    await waitFor(() => expect(mocks.write).toHaveBeenCalledWith('ssh-session', expect.stringContaining("'/home/test/config.txt'")));
    expect(mocks.toast).not.toHaveBeenCalled();
    expect(mocks.focus).toHaveBeenCalledWith('tab#0');
    expect(mocks.debug).toHaveBeenCalledWith('remote-file-terminal-action', { action: 'edit', paneId: 'tab#0', tabId: 'tab', hasSession: true, bound: false });
  });

  it('writes to the bound pane instead of the focused pane', async () => {
    useSessionStore.setState({ tabs: [
      { id: 'tab', kind: 'session', title: 'SSH', layout: sshPane('tab#0') },
      { id: 'other', kind: 'session', title: 'Other', layout: sshPane('other#0') },
    ] });
    useTerminalStore.setState({ focusedPaneId: 'tab#0', sessions: { 'tab#0': 'ssh-session', 'other#0': 'bound-session' } });
    const terminal = { isBound: true, paneId: 'other#0', cwd: '/home/other' } as import('@features/workspace').PanelTerminalState;
    render(<RemoteFiles conn={conn} terminal={terminal} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open remote file' }));
    await waitFor(() => expect(mocks.write).toHaveBeenCalledWith('bound-session', expect.stringContaining("'/home/test/config.txt'")));
    expect(mocks.debug).toHaveBeenCalledWith('remote-file-terminal-action', {
      action: 'edit', paneId: 'other#0', tabId: 'tab', hasSession: true, bound: true,
    });
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
    await waitFor(() => expect(mocks.write).toHaveBeenCalledWith('other-session', "cd -- '/home/test'\r"));
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
