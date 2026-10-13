import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ptyWrite } from '@platform/pty';
import { useTerminalStore } from '@features/terminal';
import { runCommandAndWait } from '../tools/runCommand';
import { buildTools } from '../tools';
import { usePermissions } from '../stores/permissions';
import { useSessionStore } from '@features/workspace';
import { leaf } from '@features/workspace/model/windowLayout';

vi.mock('@platform/pty', () => ({ ptyWrite: vi.fn().mockResolvedValue(undefined) }));
const terminal = useTerminalStore.getState();
const permissions = usePermissions.getState();
const workspace = useSessionStore.getState();
beforeEach(() => {
  vi.clearAllMocks();
  useTerminalStore.setState({ sessions: { first: 'pty-first', second: 'pty-second' }, focusedPaneId: 'second', scenes: {} });
});
afterEach(() => { useTerminalStore.setState(terminal, true); usePermissions.setState(permissions, true); useSessionStore.setState(workspace, true); });

describe('explicit execution targets', () => {
  it('writes to the selected terminal even when a different pane has focus', async () => {
    await runCommandAndWait('echo fixed-target', { paneId: 'first', timeoutMs: 1 });
    expect(ptyWrite).toHaveBeenCalledWith('pty-first', 'echo fixed-target\n');
  });
  it('never falls back to a focused terminal when the selected target is disconnected', async () => {
    const result = await runCommandAndWait('echo fixed-target', { paneId: 'closed-terminal' });
    expect(result.ok).toBe(false);
    expect(ptyWrite).not.toHaveBeenCalled();
  });
  it('omits terminal tools when a conversation is for discussion', () => {
    const tools = buildTools({ paneId: null });
    expect(tools).not.toHaveProperty('run_command');
    expect(tools).not.toHaveProperty('read_terminal');
    expect(tools).not.toHaveProperty('terminal_keys');
  });
  it('never exposes local file tools as remote SSH file operations', () => {
    const tools = buildTools({ paneId: 'first', remote: true });
    for (const name of ['read_file', 'write_file', 'edit_file', 'list_dir', 'search_files']) expect(tools).not.toHaveProperty(name);
    expect(tools).toHaveProperty('read_terminal');
  });
  it('derives remote file isolation from the target pane for older callers', () => {
    useSessionStore.setState({ tabs: [{ id: 'remote', kind: 'session', title: 'Server', layout: leaf({ id: 'first', kind: 'ssh', ssh: { name: 'Server', host: 'server' } }) }] });
    const tools = buildTools({ paneId: 'first' });
    for (const name of ['read_file', 'write_file', 'edit_file', 'list_dir', 'search_files']) expect(tools).not.toHaveProperty(name);
    expect(tools).toHaveProperty('run_command');
  });
});
