import { beforeEach, expect, it, vi } from 'vitest';
import { useSessionStore } from '@features/workspace';
import { useTerminalStore, useBlockStore } from '@features/terminal';
import { useInputStore } from '@features/terminal/stores/input';
import { ptyWrite } from '@platform/pty';
import { currentRunError, fillHistoryCommand, runHistoryCommand, type ExecutionContext } from '../services/execution';
import type { CommandItem } from '../model/commands';
vi.mock('@platform/pty', () => ({ ptyWrite: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@features/terminal/hooks/useTerminalSession', () => ({ setPendingTerminalCommand: vi.fn(), getExecutingTerm: vi.fn() }));
vi.mock('@features/terminal/services/terminalFocus', () => ({ focusSessionInput: vi.fn() }));
vi.mock('@features/terminal/services/terminalStartup', () => ({ waitForTerminalStartup: vi.fn().mockResolvedValue('sid') }));
const context: ExecutionContext = { target: 'local', root: '/app', scope: 'scope', cwd: '/app', paneId: 'one', spec: { id: 'one', kind: 'local', shellType: 'bash', cwd: '/app' } };
const item: CommandItem = { id: 'command', name: 'Build', command: 'npm run build', cwd: '/app', shell: 'bash' };
beforeEach(() => {
  vi.clearAllMocks();
  useSessionStore.setState({ tabs: [{ id: 'tab', kind: 'session', title: '', layout: { type: 'leaf', terminal: context.spec } }], activeId: 'tab', terminalCwds: { one: '/app' } });
  useTerminalStore.setState({ sessions: { one: 'sid' }, startupStates: { one: 'ready' }, scenes: { one: 'blockList' } });
  useBlockStore.setState({ byTab: {} });
  useInputStore.setState({ byPane: {} });
});
it('fills a command draft without writing to the PTY', () => {
  fillHistoryCommand(context, item);
  expect(useInputStore.getState().byPane.one?.text).toBe('npm run build');
  expect(ptyWrite).not.toHaveBeenCalled();
});
it('refuses current-terminal execution when the directory or shell differs, or the terminal is busy', () => {
  expect(currentRunError(context, { ...item, cwd: '/other' })).toBeTruthy();
  expect(currentRunError(context, { ...item, shell: 'pwsh' })).toBeTruthy();
  useTerminalStore.setState({ scenes: { one: 'altScreen' } });
  expect(currentRunError(context, item)).toBeTruthy();
});
it('runs in the captured terminal even after focus moves', async () => {
  useTerminalStore.setState({ focusedPaneId: 'other' });
  await runHistoryCommand(context, item, 'current');
  expect(ptyWrite).toHaveBeenCalledWith('sid', 'npm run build\n');
});
it('requires redacted parameters to be completed', async () => {
  await expect(runHistoryCommand(context, { ...item, command: 'build --token [redacted]' }, 'current')).rejects.toThrow();
  expect(ptyWrite).not.toHaveBeenCalled();
});
