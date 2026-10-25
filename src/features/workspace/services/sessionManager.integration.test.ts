import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import * as sessionManager from '@features/workspace/services/sessionManager';
import { useWorkspaceStore, isSessionTab, firstTerminalOf } from '@features/workspace/stores/workspace';
import { useBlockStore } from '@features/terminal/stores/blocks';
import { leaves } from '@features/workspace/model/windowLayout';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

const mockedInvoke = vi.mocked(invoke);
const initialWorkspace = useWorkspaceStore.getState();

function mockSession(overrides: Record<string, unknown>) {
  return {
    id: 's1', title: 't', status: 'active', created_at: 0, closed_at: null,
    block_count: 0, cwd: '', group_id: null, sort_order: 0,
    kind: 'session', payload: '{}', ...overrides,
  };
}

function defaultInvoke(cmd: string): unknown {
  switch (cmd) {
    case 'get_session_blocks': return [];
    case 'list_chat_messages': return [];
    case 'restore_session': return undefined;
    default: return undefined;
  }
}

beforeEach(() => {
  useWorkspaceStore.setState(initialWorkspace, true);
  useBlockStore.setState({ byTab: {} });
  mockedInvoke.mockReset();
  mockedInvoke.mockImplementation(async (cmd: string) => defaultInvoke(cmd));
});

describe('sessionManager.restore（窗口布局）', () => {
  it('从旧 ssh payload 恢复含 SSH 终端的窗口', async () => {
    const session = mockSession({
      id: 'ssh-1', title: '生产服务器', kind: 'ssh',
      payload: JSON.stringify({ ssh: { name: '生产服务器', host: 'prod.example.com', user: 'root', port: 22, connectionId: 'c1' } }),
    });
    mockedInvoke.mockImplementation(async (cmd: string) => (cmd === 'get_session' ? session : defaultInvoke(cmd)));

    await sessionManager.restore('ssh-1', '生产服务器');
    const tab = useWorkspaceStore.getState().tabs.find((t) => t.id === 'ssh-1')!;
    expect(tab.kind).toBe('session');
    const term = firstTerminalOf(tab)!;
    expect(term.kind).toBe('ssh');
    expect(term.ssh?.host).toBe('prod.example.com');
    expect(term.ssh?.user).toBe('root');
    expect(term.ssh?.connectionId).toBe('c1');
  });

  it('从旧 shellType payload 恢复本地终端窗口', async () => {
    const session = mockSession({ id: 'local-1', title: 'Zsh', kind: 'local', payload: JSON.stringify({ shellType: 'zsh' }) });
    mockedInvoke.mockImplementation(async (cmd: string) => (cmd === 'get_session' ? session : defaultInvoke(cmd)));

    await sessionManager.restore('local-1', 'Zsh');
    const tab = useWorkspaceStore.getState().tabs.find((t) => t.id === 'local-1')!;
    expect(tab.kind).toBe('session');
    expect(firstTerminalOf(tab)!.shellType).toBe('zsh');
  });

  it('从 layout payload 恢复窗口布局（多终端）', async () => {
    const layout = {
      type: 'split', dir: 'row', ratio: 0.4,
      first: { type: 'leaf', terminal: { id: 's#0', kind: 'local', shellType: 'zsh' } },
      second: { type: 'leaf', terminal: { id: 's#1', kind: 'ssh', ssh: { name: 'x', host: 'h', user: 'u' } } },
    };
    const session = mockSession({ id: 's', kind: 'session', payload: JSON.stringify({ layout }) });
    mockedInvoke.mockImplementation(async (cmd: string) => (cmd === 'get_session' ? session : defaultInvoke(cmd)));

    await sessionManager.restore('s', 's');
    const tab = useWorkspaceStore.getState().tabs.find((t) => t.id === 's')!;
    expect(leaves(tab.kind === 'session' ? tab.layout : { type: 'leaf', terminal: { id: 'x', kind: 'local' } })).toHaveLength(2);
  });

  it('meta.groupId 覆盖后端 group_id', async () => {
    const session = mockSession({ id: 'g-tab', group_id: null, payload: '{}' });
    mockedInvoke.mockImplementation(async (cmd: string) => (cmd === 'get_session' ? session : defaultInvoke(cmd)));
    await sessionManager.restore('g-tab', 't', { groupId: 'g1' });
    const tab = useWorkspaceStore.getState().tabs.find((t) => t.id === 'g-tab')!;
    expect(isSessionTab(tab) && tab.groupId).toBe('g1');
  });

  it('reopens the original group when restoring only one session', async () => {
    const session = mockSession({ id: 'g-tab', group_id: 'archived-group', payload: '{}' });
    mockedInvoke.mockImplementation(async (cmd: string) => cmd === 'get_session' ? session
      : cmd === 'groups_list' ? [{ id: 'archived-group', title: 'Project', collapsed: false, archived: false, session_count: 1 }]
      : defaultInvoke(cmd));

    await sessionManager.restore('g-tab', 't');

    const tab = useWorkspaceStore.getState().tabs.find((item) => item.id === 'g-tab')!;
    expect(isSessionTab(tab) && tab.groupId).toBe('archived-group');
    expect(useWorkspaceStore.getState().groups).toEqual([{ id: 'archived-group', title: 'Project', collapsed: false }]);
    expect(mockedInvoke).not.toHaveBeenCalledWith('session_set_group', expect.anything());
    expect(mockedInvoke).not.toHaveBeenCalledWith('group_restore', expect.anything());
  });

  it('inserts partial restores in their saved order and retains membership if the group lookup fails', async () => {
    const first = mockSession({ id: 'first', group_id: 'g1', sort_order: 0 });
    const last = mockSession({ id: 'last', group_id: 'g1', sort_order: 2 });
    mockedInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === 'get_session') return (args as { id: string }).id === 'first' ? first : last;
      if (cmd === 'groups_list') return [{ id: 'g1', title: 'Project', collapsed: false }];
      if (cmd === 'list_sessions') return [first, last];
      return defaultInvoke(cmd);
    });
    await sessionManager.restore('last', 'Last');
    await sessionManager.restore('first', 'First');
    expect(useWorkspaceStore.getState().tabs.map(tab => tab.id)).toEqual(['first', 'last']);

    useWorkspaceStore.setState(initialWorkspace, true);
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_session') return first;
      if (cmd === 'groups_list') throw new Error('Unavailable');
      return defaultInvoke(cmd);
    });
    await sessionManager.restore('first', 'First');
    expect(useWorkspaceStore.getState().tabs.some(tab => tab.id === 'first')).toBe(true);
    expect(mockedInvoke).not.toHaveBeenCalledWith('session_set_group', expect.anything());
  });

  it('does not create a visible tab when persisting restoration fails', async () => {
    mockedInvoke.mockRejectedValue(new Error('Unavailable'));
    await expect(sessionManager.restore('failed', 'Failed')).rejects.toThrow('Unavailable');
    expect(useWorkspaceStore.getState().tabs).toHaveLength(0);
  });

  it('payload 损坏时降级为单本地终端', async () => {
    const session = mockSession({ id: 'bad', payload: 'not-json' });
    mockedInvoke.mockImplementation(async (cmd: string) => (cmd === 'get_session' ? session : defaultInvoke(cmd)));
    await sessionManager.restore('bad', 'bad');
    const tab = useWorkspaceStore.getState().tabs.find((t) => t.id === 'bad')!;
    expect(tab.kind).toBe('session');
    expect(firstTerminalOf(tab)!.kind).toBe('local');
  });
});

describe('addTab 持久化 kind + payload', () => {
  it('persists a remote terminal layout without credentials when content starts', async () => {
    const calls: Array<{ cmd: string; args: Record<string, unknown> }> = [];
    mockedInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
      calls.push({ cmd, args: (args ?? {}) as Record<string, unknown> });
      return undefined;
    });

    useWorkspaceStore.getState().addTab({ kind: 'ssh', ssh: { name: 'prod', host: 'prod.example.com', user: 'root', port: 22, connectionId: 'c1' } });
    expect(calls.find(call => call.cmd === 'create_session')).toBeUndefined();
    await sessionManager.ensureContentSession(useWorkspaceStore.getState().activeId);
    const create = calls.find((c) => c.cmd === 'create_session');
    expect(create).toBeTruthy();
    expect(create!.args.kind).toBe('session');
    const payload = JSON.parse(create!.args.payload as string) as { layout: { terminal: { ssh: Record<string, unknown> } } };
    expect(payload.layout.terminal.ssh.host).toBe('prod.example.com');
    expect('password' in payload.layout.terminal.ssh).toBe(false);
  });

  it('persists a local terminal layout when content starts', async () => {
    const calls: Array<{ cmd: string; args: Record<string, unknown> }> = [];
    mockedInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
      calls.push({ cmd, args: (args ?? {}) as Record<string, unknown> });
      return undefined;
    });
    useWorkspaceStore.getState().addTab({ shellType: 'zsh' });
    await sessionManager.ensureContentSession(useWorkspaceStore.getState().activeId);
    const create = calls.find((c) => c.cmd === 'create_session');
    expect(create!.args.kind).toBe('session');
    const payload = JSON.parse(create!.args.payload as string) as { layout: { terminal: { shellType: string } } };
    expect(payload.layout.terminal.shellType).toBe('zsh');
  });

  it('视图标签（history/settings）不落库', () => {
    const calls: Array<{ cmd: string; args: Record<string, unknown> }> = [];
    mockedInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
      calls.push({ cmd, args: (args ?? {}) as Record<string, unknown> });
      return undefined;
    });
    useWorkspaceStore.getState().addTab({ kind: 'history' });
    useWorkspaceStore.getState().openSettings();
    expect(calls.find((c) => c.cmd === 'create_session')).toBeUndefined();
  });
});
