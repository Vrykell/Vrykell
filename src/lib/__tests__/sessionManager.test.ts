import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import * as sessionManager from '../sessionManager';
import { useWorkspaceStore, isSessionTab } from '../../stores/workspace';
import { useBlockStore } from '../../stores/blocks';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

const mockedInvoke = vi.mocked(invoke);
const initialWorkspace = useWorkspaceStore.getState();

function mockSession(overrides: Record<string, unknown>) {
  return {
    id: 's1',
    title: 't',
    status: 'active',
    created_at: 0,
    closed_at: null,
    block_count: 0,
    cwd: '',
    group_id: null,
    sort_order: 0,
    kind: 'local',
    payload: '{}',
    ...overrides,
  };
}

/** 默认响应：restore 相关命令返回空值，避免 undefined.length 崩溃。 */
function defaultInvoke(cmd: string): unknown {
  switch (cmd) {
    case 'get_session_blocks':
      return [];
    case 'list_chat_messages':
      return [];
    case 'restore_session':
      return undefined;
    default:
      return undefined;
  }
}

beforeEach(() => {
  useWorkspaceStore.setState(initialWorkspace, true);
  useBlockStore.setState({ byTab: {} });
  mockedInvoke.mockReset();
  mockedInvoke.mockImplementation(async (cmd: string) => defaultInvoke(cmd));
});

describe('sessionManager.restore（按 kind + payload 重建标签）', () => {
  it('从 kind=ssh + payload 重建 SSH 标签，保留 host/user/port/connectionId', async () => {
    const session = mockSession({
      id: 'ssh-1',
      title: '生产服务器',
      kind: 'ssh',
      payload: JSON.stringify({
        ssh: { name: '生产服务器', host: 'prod.example.com', user: 'root', port: 22, connectionId: 'c1' },
      }),
    });
    mockedInvoke.mockImplementation(async (cmd: string) =>
      cmd === 'get_session' ? session : defaultInvoke(cmd),
    );

    await sessionManager.restore('ssh-1', '生产服务器');
    const tab = useWorkspaceStore.getState().tabs.find((t) => t.id === 'ssh-1')!;
    expect(tab.kind).toBe('ssh');
    if (tab.kind === 'ssh') {
      expect(tab.ssh.name).toBe('生产服务器');
      expect(tab.ssh.host).toBe('prod.example.com');
      expect(tab.ssh.user).toBe('root');
      expect(tab.ssh.port).toBe(22);
      expect(tab.ssh.connectionId).toBe('c1');
    }
  });

  it('从 kind=local + shellType payload 重建本地标签，恢复 cwd', async () => {
    const session = mockSession({
      id: 'local-1',
      title: 'Zsh',
      cwd: '/home/u',
      kind: 'local',
      payload: JSON.stringify({ shellType: 'zsh' }),
    });
    mockedInvoke.mockImplementation(async (cmd: string) =>
      cmd === 'get_session' ? session : defaultInvoke(cmd),
    );

    await sessionManager.restore('local-1', 'Zsh');
    const tab = useWorkspaceStore.getState().tabs.find((t) => t.id === 'local-1')!;
    expect(tab.kind).toBe('local');
    if (tab.kind === 'local') {
      expect(tab.shellType).toBe('zsh');
      expect(tab.cwd).toBe('/home/u');
    }
  });

  it('meta.groupId 覆盖后端 group_id（恢复分组时保持嵌套）', async () => {
    const session = mockSession({ id: 'g-tab', group_id: null, kind: 'local', payload: '{}' });
    mockedInvoke.mockImplementation(async (cmd: string) =>
      cmd === 'get_session' ? session : defaultInvoke(cmd),
    );

    await sessionManager.restore('g-tab', 't', { groupId: 'g1' });
    const tab = useWorkspaceStore.getState().tabs.find((t) => t.id === 'g-tab')!;
    expect(isSessionTab(tab) && tab.groupId).toBe('g1');
  });

  it('恢复时按 pane_id 分组 blocks 并回读 collapsed', async () => {
    const session = mockSession({ id: 'sp', kind: 'local', payload: '{}' });
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_session') return session;
      if (cmd === 'get_session_blocks') {
        return [
          { id: 'b1', session_id: 'sp', pane_id: 'sp', command: 'ls', output_raw: '', output_clean: 'o', exit_code: 0, status: 'done', started_at: 1, ended_at: 2, collapsed: true },
          { id: 'b2', session_id: 'sp', pane_id: 'sp#2', command: 'pwd', output_raw: '', output_clean: '/x', exit_code: 0, status: 'done', started_at: 3, ended_at: 4, collapsed: false },
        ];
      }
      return defaultInvoke(cmd);
    });

    await sessionManager.restore('sp', 'sp');
    const blocks = useBlockStore.getState();
    expect(blocks.byTab['sp']?.map((b) => b.id)).toEqual(['b1']);
    expect(blocks.byTab['sp']![0]!.collapsed).toBe(true);
    expect(blocks.byTab['sp#2']?.map((b) => b.id)).toEqual(['b2']);
    expect(blocks.byTab['sp#2']![0]!.collapsed).toBeUndefined();
  });

  it('payload 损坏时不崩溃，降级为空字段', async () => {
    const session = mockSession({ id: 'bad', kind: 'ssh', payload: 'not-json' });
    mockedInvoke.mockImplementation(async (cmd: string) =>
      cmd === 'get_session' ? session : defaultInvoke(cmd),
    );

    await sessionManager.restore('bad', 'bad');
    const tab = useWorkspaceStore.getState().tabs.find((t) => t.id === 'bad')!;
    expect(tab.kind).toBe('ssh');
    if (tab.kind === 'ssh') expect(tab.ssh.host).toBe('');
  });
});

describe('addTab 持久化 kind + payload', () => {
  it('SSH 标签落库时携带 kind=ssh 与 ssh payload（不含密码）', () => {
    const calls: Array<{ cmd: string; args: Record<string, unknown> }> = [];
    mockedInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
      calls.push({ cmd, args: (args ?? {}) as Record<string, unknown> });
      return undefined;
    });

    useWorkspaceStore.getState().addTab({
      kind: 'ssh',
      ssh: { name: 'prod', host: 'prod.example.com', user: 'root', port: 22, connectionId: 'c1' },
    });

    const create = calls.find((c) => c.cmd === 'create_session');
    expect(create).toBeTruthy();
    expect(create!.args.kind).toBe('ssh');

    const payload = JSON.parse(create!.args.payload as string) as {
      ssh: { name: string; host: string; user: string | null; port: number | null; connectionId: string | null };
    };
    expect(payload.ssh.host).toBe('prod.example.com');
    expect(payload.ssh.user).toBe('root');
    expect(payload.ssh.connectionId).toBe('c1');
    // 密码绝不进 payload
    expect('password' in payload.ssh).toBe(false);
  });

  it('本地标签落库时携带 kind=local 与 shellType payload', () => {
    const calls: Array<{ cmd: string; args: Record<string, unknown> }> = [];
    mockedInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
      calls.push({ cmd, args: (args ?? {}) as Record<string, unknown> });
      return undefined;
    });

    useWorkspaceStore.getState().addTab({ shellType: 'zsh' });

    const create = calls.find((c) => c.cmd === 'create_session');
    expect(create).toBeTruthy();
    expect(create!.args.kind).toBe('local');
    const payload = JSON.parse(create!.args.payload as string) as { shellType: string | null };
    expect(payload.shellType).toBe('zsh');
  });

  it('视图标签（history/settings）不落库', () => {
    const calls: Array<{ cmd: string; args: Record<string, unknown> }> = [];
    mockedInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
      calls.push({ cmd, args: (args ?? {}) as Record<string, unknown> });
      return undefined;
    });

    useWorkspaceStore.getState().addTab({ kind: 'history' });
    useWorkspaceStore.getState().addTab({ kind: 'settings' });

    expect(calls.find((c) => c.cmd === 'create_session')).toBeUndefined();
  });
});
