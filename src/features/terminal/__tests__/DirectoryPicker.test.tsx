import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import DirectoryPicker from '../components/DirectoryPicker';
import { useSessionStore } from '@features/workspace';
import { useTerminalStore, useInputStore, useBlockStore } from '@features/terminal';
import type { FileListResult } from '@features/files/model/fileOps';

const mocks = vi.hoisted(() => ({ list: vi.fn(), factory: vi.fn(), write: vi.fn(), pending: vi.fn(), follow: vi.fn() }));
vi.mock('@features/files', () => ({ fileOpsFor: mocks.factory }));
vi.mock('@platform/pty', () => ({ ptyWrite: mocks.write }));
vi.mock('../hooks/useTerminalSession', () => ({ setPendingTerminalCommand: mocks.pending }));
vi.mock('../hooks/useFollowBottom', () => ({ engageFollow: mocks.follow }));
const snapshots = [useSessionStore.getState(), useTerminalStore.getState(), useInputStore.getState(), useBlockStore.getState()] as const;
const folders: FileListResult = { base: null, entries: [
  { name: 'Documents', path: '/work/Documents', is_dir: true },
  { name: "it's a folder", path: "/work/it's a folder", is_dir: true },
  { name: 'notes.txt', path: '/work/notes.txt', is_dir: false },
] };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue(folders);
  mocks.write.mockResolvedValue(undefined);
  mocks.factory.mockReturnValue({ list: mocks.list, parentOf: (path: string) => path === '/' ? null : path.slice(0, path.lastIndexOf('/')) || '/' });
  useTerminalStore.setState({ sessions: { pane: 'pty' } });
  useBlockStore.setState({ byTab: {} });
  useInputStore.setState({ byPane: { pane: { text: 'my draft', aiMode: false } } });
  useSessionStore.setState({ tabs: [{ id: 'tab', kind: 'session', title: 'Shell', layout: { type: 'leaf', terminal: { id: 'pane', kind: 'local', shellType: 'bash' } } }] });
});
afterEach(() => {
  cleanup();
  useSessionStore.setState(snapshots[0], true);
  useTerminalStore.setState(snapshots[1], true);
  useInputStore.setState(snapshots[2], true);
  useBlockStore.setState(snapshots[3], true);
});
it('searches folders, keeps the parent choice, and navigates without losing the draft', async () => {
  render(<DirectoryPicker paneId="pane" dir="/work" />);
  fireEvent.click(screen.getByRole('button', { name: '切换工作目录' }));
  await screen.findByRole('option', { name: 'Documents' });
  expect(screen.queryByRole('option', { name: 'notes.txt' })).toBeNull();
  fireEvent.change(screen.getByRole('combobox'), { target: { value: "it's" } });
  expect(screen.queryByRole('option', { name: 'Documents' })).toBeNull();
  expect(screen.getByRole('button', { name: '上级目录' })).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
  await waitFor(() => expect(mocks.write).toHaveBeenCalledWith('pty', "cd -- '/work/it'\\''s a folder'\n"));
  expect(useInputStore.getState().byPane.pane.text).toBe('my draft');
  expect(screen.queryByRole('dialog')).toBeNull();
});
it('reports directory-read failures inline and retries', async () => {
  mocks.list.mockRejectedValueOnce(new Error('Unavailable'));
  render(<DirectoryPicker paneId="pane" dir="/work" />);
  fireEvent.click(screen.getByRole('button', { name: '切换工作目录' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Unavailable');
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  await screen.findByRole('option', { name: 'Documents' });
  expect(mocks.list).toHaveBeenCalledTimes(2);
});
it('uses the remote file interface and ignores a stale listing after the directory changes', async () => {
  let resolve!: (result: FileListResult) => void;
  mocks.list.mockReturnValueOnce(new Promise<FileListResult>(done => { resolve = done; }));
  useSessionStore.setState({ tabs: [{ id: 'tab', kind: 'session', title: 'Remote', layout: { type: 'leaf', terminal: { id: 'pane', kind: 'ssh', ssh: { name: 'host', host: 'host', connectionId: 'remote' } } } }] });
  const view = render(<DirectoryPicker paneId="pane" dir="/work" />);
  fireEvent.click(screen.getByRole('button', { name: '切换工作目录' }));
  expect(mocks.factory).toHaveBeenCalledWith({ kind: 'ssh', connectionId: 'remote' });
  view.rerender(<DirectoryPicker paneId="pane" dir="/other" />);
  await act(async () => resolve(folders));
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '切换工作目录' }));
  await screen.findByRole('option', { name: 'Documents' });
  expect(mocks.list).toHaveBeenLastCalledWith('/other');
  fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
});
it('disables navigation without a live session or a known directory', () => {
  useTerminalStore.setState({ sessions: {} });
  render(<DirectoryPicker paneId="pane" />);
  expect(screen.getByRole('button', { name: '切换工作目录' })).toBeDisabled();
});
it('keeps a disconnected remote pane from browsing the local filesystem', () => {
  useSessionStore.setState({ tabs: [{ id: 'tab', kind: 'session', title: 'Remote', layout: { type: 'leaf', terminal: { id: 'pane', kind: 'ssh', ssh: { name: 'host', host: 'host' } } } }] });
  render(<DirectoryPicker paneId="pane" dir="/work" />);
  const trigger = screen.getByRole('button', { name: '切换工作目录' });
  expect(trigger).toBeDisabled();
  fireEvent.click(trigger);
  expect(mocks.list).not.toHaveBeenCalled();
  expect(mocks.factory).not.toHaveBeenCalledWith({ kind: 'local' });
});

it('keeps the parent fixed outside the directory list and starts with neutral rows', async () => {
  render(<DirectoryPicker paneId="pane" dir="/work" />);
  fireEvent.click(screen.getByRole('button', { name: '切换工作目录' }));
  const folder = await screen.findByRole('option', { name: 'Documents' });
  const parent = screen.getByRole('button', { name: '上级目录' });
  expect(parent.closest('[role="listbox"]')).toBeNull();
  expect(folder).toHaveAttribute('aria-selected', 'false');
  fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown' });
  expect(folder).toHaveAttribute('aria-selected', 'true');
  fireEvent.click(parent);
  await waitFor(() => expect(mocks.write).toHaveBeenCalledWith('pty', "cd -- '/'\n"));
});

it('clears keyboard emphasis on pointer movement without scrolling or changing the directory', async () => {
  render(<DirectoryPicker paneId="pane" dir="/work" />);
  fireEvent.click(screen.getByRole('button', { name: '切换工作目录' }));
  const folder = await screen.findByRole('option', { name: 'Documents' });
  const scroll = vi.fn();
  folder.scrollIntoView = scroll;
  fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown' });
  expect(folder).toHaveAttribute('data-active', 'true');
  expect(scroll).toHaveBeenCalledOnce();
  fireEvent(folder, new MouseEvent('pointermove', { bubbles: true, clientX: 20, clientY: 30 }));
  expect(folder).toHaveAttribute('data-active', 'false');
  expect(scroll).toHaveBeenCalledOnce();
  expect(mocks.write).not.toHaveBeenCalled();
});
