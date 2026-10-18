import { beforeEach, expect, it, vi } from 'vitest';
import { openGitFile } from '../services/openFile';
import { openFile, remoteOpenCommand } from '@features/files';
import { ptyWrite } from '@platform/pty';

const mock = vi.hoisted(() => ({ addTab: vi.fn(() => 'new'), tabs: [] as { id: string; terminals: { id: string; kind: string; ssh?: { connectionId: string; host: string; name: string } }[] }[] }));
vi.mock('@features/workspace', () => ({ useSessionStore: { getState: () => mock }, terminalsOf: (tab: { terminals: unknown[] }) => tab.terminals }));
vi.mock('@features/files', () => ({ openFile: vi.fn(), loadFileOpenConfig: () => ({}), remoteOpenCommand: vi.fn(() => 'edit quoted-path'), openPreferredFile: (_file: unknown, fallback: () => Promise<void>) => fallback() }));
vi.mock('@platform/pty', () => ({ ptyWrite: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@features/terminal/services/terminalStartup', () => ({ waitForTerminalStartup: vi.fn().mockResolvedValue('session') }));
beforeEach(() => { vi.clearAllMocks(); mock.tabs = []; });

it('uses the configured local file opener and starts an independent editor terminal', async () => {
  vi.mocked(openFile).mockImplementation(async (_path, write) => { write('edit quoted-path'); return { via: 'terminal', editor: 'edit', fellBack: false }; });
  await openGitFile({ target: { cwd: '/repo' }, path: 'src/file.ts', paneId: 'owner', scope: 'unstaged' });
  expect(openFile).toHaveBeenCalledWith('/repo/src/file.ts', expect.any(Function));
  expect(mock.addTab).toHaveBeenCalledWith({ cwd: '/repo', title: 'file.ts' });
  expect(ptyWrite).toHaveBeenCalledWith('session', 'edit quoted-path\n');
});

it('keeps remote file commands on a new terminal for the same connection', async () => {
  mock.tabs = [{ id: 'owner', terminals: [{ id: 'owner#0', kind: 'ssh', ssh: { connectionId: 'remote', host: 'example.invalid', name: 'Remote' } }] }];
  await openGitFile({ target: { cwd: '/repo', connectionId: 'remote' }, path: 'file.ts', paneId: 'owner#0', scope: 'unstaged' });
  expect(remoteOpenCommand).toHaveBeenCalledWith({}, '/repo/file.ts');
  expect(mock.addTab).toHaveBeenCalledWith(expect.objectContaining({ kind: 'ssh', ssh: expect.objectContaining({ connectionId: 'remote' }) }));
  expect(openFile).not.toHaveBeenCalled();
});
