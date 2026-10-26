import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ windows: false, add: vi.fn(() => 'new-tab'), write: vi.fn(), admin: vi.fn(), open: vi.fn() }));
vi.mock('@platform/runtime', () => ({ get isWindows() { return mocks.windows; } }));
vi.mock('@platform/shells', () => ({ getAvailableShells: async () => [{ id: 'bash', label: 'Bash', default: true }] }));
vi.mock('@platform/api/editor', () => ({ openElevatedEditorFile: mocks.admin }));
vi.mock('@platform/pty', () => ({ ptyWrite: mocks.write }));
vi.mock('@features/terminal/services/terminalStartup', () => ({ waitForTerminalStartup: vi.fn(async () => 'new-session') }));
vi.mock('@features/workspace', () => ({ useSessionStore: { getState: () => ({ tabs: [{ kind: 'ssh', ssh: { connectionId: 'remote' } }], addTab: mocks.add }) }, terminalsOf: (tab: unknown) => [tab] }));
vi.mock('../services/fileOpen', () => ({ openFile: mocks.open, loadConfig: () => ({}), remoteOpenCommand: () => 'vim /remote/file\n' }));
import { openInTerminal } from '../services/openInTerminal';

beforeEach(() => { vi.clearAllMocks(); mocks.windows = false; });
it('separates normal remote editing from an explicitly elevated terminal', async () => {
  await openInTerminal({ path: '/remote/file', connectionId: 'remote' });
  expect(mocks.write).toHaveBeenLastCalledWith('new-session', 'vim /remote/file\n');
  await openInTerminal({ path: "/remote/file's name", connectionId: 'remote' }, true);
  expect(mocks.write).toHaveBeenLastCalledWith('new-session', "sudoedit -- '/remote/file'\\''s name'\n");
  expect(mocks.add).toHaveBeenLastCalledWith(expect.objectContaining({ title: "提权编辑：file's name", kind: 'ssh' }));
});
it('opens local elevated files through the system prompt on Windows', async () => {
  mocks.windows = true;
  await openInTerminal({ path: 'C:/protected/file.txt' }, true);
  expect(mocks.admin).toHaveBeenCalledWith({ path: 'C:/protected/file.txt' });
  expect(mocks.write).not.toHaveBeenCalled();
  expect(mocks.add).not.toHaveBeenCalled();
});
it('uses an explicitly labelled elevated terminal for local files on Unix', async () => {
  await openInTerminal({ path: '/etc/protected config' }, true);
  expect(mocks.write).toHaveBeenCalledWith('new-session', "sudoedit -- '/etc/protected config'\n");
  expect(mocks.add).toHaveBeenCalledWith(expect.objectContaining({ title: '提权编辑：protected config' }));
});
