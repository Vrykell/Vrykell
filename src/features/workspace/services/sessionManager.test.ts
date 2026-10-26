/**
 * sessionManager — 会话生命周期（create/close/restore/rename/record 等）测试。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

import * as sessionManager from '@features/workspace/services/sessionManager';
import { useSessionStore, isSessionTab } from '@features/workspace';
import { useBlockStore } from '@features/terminal/stores/blocks';
import { useChatStore } from '@features/chat/stores/chat';

const wsInitial = useSessionStore.getState();

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation(() => Promise.reject(new Error('no backend')));
  useSessionStore.setState(wsInitial, true);
  useBlockStore.setState({ byTab: {} });
  useChatStore.setState({ byTab: {} });
});

describe('sessionManager 生命周期', () => {
  it('classifies drafts without writing them and waits for existing first writes', async () => {
    invokeMock.mockResolvedValue(undefined);
    await sessionManager.create('group-draft', 'Draft');
    expect(await sessionManager.persistedSessionIds(['group-draft', 'saved'])).toEqual(new Set(['saved']));
    expect(invokeMock).not.toHaveBeenCalled();
    let finish!: () => void;
    invokeMock.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const saving = sessionManager.ensureContentSession('group-draft');
    const classified = sessionManager.persistedSessionIds(['group-draft']);
    finish(); await saving;
    expect(await classified).toEqual(new Set(['group-draft']));
  });
  it('retains metadata changes made while the first insert is in flight', async () => {
    let finish!: () => void;
    invokeMock.mockResolvedValue(undefined);
    invokeMock.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    await sessionManager.create('late-metadata', 'Draft', '/first');
    const saving = sessionManager.ensureContentSession('late-metadata');
    await sessionManager.rename('late-metadata', 'Updated title');
    await sessionManager.setCwd('late-metadata', '/updated');
    finish(); await saving;
    expect(invokeMock).toHaveBeenCalledWith('update_session_title', { id: 'late-metadata', title: 'Updated title' });
    expect(invokeMock).toHaveBeenCalledWith('update_session_cwd', { id: 'late-metadata', cwd: '/updated' });
  });
  it('skips empty blocks and writes the session once for concurrent first records', async () => {
    invokeMock.mockResolvedValue(undefined);
    await sessionManager.create('lazy-record', 'Draft', '/project');
    const block = { id: 'lazy-block', command: '', status: 'done', exitCode: 0, startedAt: 1, endedAt: 2,
      outputHtml: '', outputText: '', outputRaw: '', wasLongRunning: false, linesTruncated: 0 } as const;
    await sessionManager.record('lazy-record', 'lazy-record#0', block, 'complete');
    expect(invokeMock).not.toHaveBeenCalled();
    await Promise.all([
      sessionManager.record('lazy-record', 'lazy-record#0', { ...block, command: 'pwd' }, 'start'),
      sessionManager.record('lazy-record', 'lazy-record#0', { ...block, command: 'pwd', outputText: '/project' }, 'complete'),
    ]);
    expect(invokeMock.mock.calls.filter(([command]) => command === 'create_session')).toHaveLength(1);
    expect(invokeMock.mock.calls.filter(([command]) => command === 'record_block')).toHaveLength(2);
    await sessionManager.close('lazy-record');
    expect(invokeMock).toHaveBeenLastCalledWith('archive_session', expect.objectContaining({ id: 'lazy-record' }));
  });
  it('defers a session row until it has content', async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    await sessionManager.create('t1', '标题', '/cwd', 'session', '{}');
    expect(invokeMock).not.toHaveBeenCalled();
    await sessionManager.ensureContentSession('t1');
    expect(invokeMock).toHaveBeenCalledWith('create_session', {
      id: 't1', title: '标题', timestamp: expect.any(Number), cwd: '/cwd', kind: 'session', payload: '{}',
    });
    await sessionManager.create('empty-session', 'Empty');
    invokeMock.mockClear();
    await sessionManager.rename('empty-session', 'Renamed');
    await sessionManager.setCwd('empty-session', '/other');
    await sessionManager.close('empty-session');
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('close / rename / remove：透传与失败静默', async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    await sessionManager.close('t1');
    expect(invokeMock).toHaveBeenCalledWith('archive_session', { id: 't1', timestamp: expect.any(Number) });
    invokeMock.mockResolvedValueOnce(undefined);
    await sessionManager.rename('t1', '新名');
    expect(invokeMock).toHaveBeenCalledWith('update_session_title', { id: 't1', title: '新名' });
    invokeMock.mockResolvedValueOnce(undefined);
    await sessionManager.remove('t1');
    expect(invokeMock).toHaveBeenCalledWith('delete_session', { id: 't1' });
    await expect(sessionManager.remove('t2')).rejects.toThrow('no backend');
  });

  it('restore：完整重建（layout 用 payload；blocks 按 pane 归属；chat 恢复）', async () => {
    const sessionId = 'restored-1';
    useSessionStore.setState({ groups: [{ id: 'g9', title: '恢复分组', collapsed: false }] });
    invokeMock.mockResolvedValueOnce(undefined); // restore_session
    invokeMock.mockResolvedValueOnce([
      { id: 'b1', pane_id: null, command: 'ls', cwd: '/original/path', exit_code: 0, started_at: 1, ended_at: 2, status: 'done', collapsed: true, output_clean: 'out', output_raw: 'out', output_html: '' },
      { id: 'b2', pane_id: `${sessionId}#1`, command: 'pwd', exit_code: null, started_at: 3, ended_at: null, status: 'running', collapsed: null, output_clean: '', output_raw: '', output_html: '' },
    ]); // get_session_blocks
    invokeMock.mockResolvedValueOnce([
      { id: 'c1', role: 'user', content: '你好', created_at: 1, parts: '', attachments: '' },
      { id: 'c2', role: 'assistant', content: '在的', created_at: 2, parts: '', attachments: '' },
    ]); // list_chat_messages
    invokeMock.mockResolvedValueOnce({
      id: sessionId, title: '旧标题', kind: 'session', payload: JSON.stringify({ layout: { type: 'leaf', terminal: { id: `${sessionId}#0`, kind: 'local' } } }), group_id: 'g9', cwd: '/latest/path', created_at: 1, updated_at: 2, archived_at: null,
    }); // get_session
    await sessionManager.restore(sessionId, '恢复的标题');
    const s = useSessionStore.getState();
    const tab = s.tabs.find((t) => t.id === sessionId)!;
    expect(tab).toBeDefined();
    expect(s.activeId).toBe(sessionId);
    expect(tab.title).toBe('恢复的标题');
    expect(isSessionTab(tab) && tab.groupId).toBe('g9');
    expect(isSessionTab(tab) && tab.layout.type === 'leaf' && tab.layout.terminal.cwd).toBe('/latest/path');
    // blocks 归属：pane null → #0
    expect(useBlockStore.getState().byTab[`${sessionId}#0`]).toHaveLength(1);
    const restored = useBlockStore.getState().byTab[`${sessionId}#0`]![0]!;
    expect(restored.outputText).toBe('out');
    expect(restored.cwd).toBe('/original/path');
    expect(useBlockStore.getState().byTab[`${sessionId}#1`]![0]!.cwd).toBe('/latest/path');
    expect(restored).not.toHaveProperty('collapsed');
    expect(invokeMock).not.toHaveBeenCalledWith('set_block_collapsed', expect.anything());
    expect(useBlockStore.getState().byTab[`${sessionId}#1`]).toHaveLength(1);
    // chat 恢复
    expect(useChatStore.getState().byTab[sessionId]).toHaveLength(2);
  });

  it('restore：无 blocks/chat 时清空 chat；tab 已存在时 activate', async () => {
    // 模拟已有一个活跃标签（store 不再内置初始标签）
    const sessionId = useSessionStore.getState().addTab({});
    invokeMock.mockResolvedValueOnce(undefined); // restore_session
    invokeMock.mockResolvedValueOnce([]); // blocks
    invokeMock.mockResolvedValueOnce([]); // chat
    invokeMock.mockResolvedValueOnce({ id: sessionId, title: 'x', kind: 'session', payload: 'garbage{{{', group_id: null, cwd: null, created_at: 1, updated_at: 2, archived_at: null }); // get_session
    await sessionManager.restore(sessionId, 'T');
    expect(useSessionStore.getState().activeId).toBe(sessionId);
    expect(useChatStore.getState().byTab[sessionId]).toBeUndefined();
  });

  it('restore：ssh 旧 payload 与 shellType 旧 payload 兼容解析', async () => {
    const sid1 = 'ssh-session';
    invokeMock.mockResolvedValueOnce(undefined);
    invokeMock.mockResolvedValueOnce([]);
    invokeMock.mockResolvedValueOnce([]);
    invokeMock.mockResolvedValueOnce({ id: sid1, title: 'ssh', kind: 'session', payload: JSON.stringify({ ssh: { name: 'prod', host: 'h', user: 'root', port: 22, connectionId: 'c' } }), group_id: null, cwd: null, created_at: 1, updated_at: 2, archived_at: null });
    await sessionManager.restore(sid1, 'ssh');
    let tab = useSessionStore.getState().tabs.find((t) => t.id === sid1)!;
    let term = (tab as { layout: { terminal: { kind: string; ssh?: { host: string; user?: string; port?: number } } } }).layout.terminal as { kind: string; ssh?: { host: string }; shellType?: string };
    expect(term.kind).toBe('ssh');
    expect(term.ssh?.host).toBe('h');

    const sid2 = 'local-session';
    invokeMock.mockResolvedValueOnce(undefined);
    invokeMock.mockResolvedValueOnce([]);
    invokeMock.mockResolvedValueOnce([]);
    invokeMock.mockResolvedValueOnce({ id: sid2, title: 'l', kind: 'session', payload: JSON.stringify({ shellType: 'zsh' }), group_id: null, cwd: null, created_at: 1, updated_at: 2, archived_at: null });
    await sessionManager.restore(sid2, 'l');
    tab = useSessionStore.getState().tabs.find((t) => t.id === sid2)!;
    term = (tab as { layout: { terminal: { kind: string; shellType?: string } } }).layout.terminal as { kind: string; ssh?: { host: string }; shellType?: string };
    expect(term.kind).toBe('local');
    expect(term.shellType).toBe('zsh');
  });

  it('record：start 与 complete 透传', async () => {
    const block = {
      id: 'b1', command: 'ls', status: 'done', exitCode: 0, startedAt: 1, endedAt: 2,
      outputHtml: '', outputText: 'out', outputRaw: 'raw', cwd: '/execution/path', wasLongRunning: false,
    };
    invokeMock.mockResolvedValueOnce(undefined);
    await sessionManager.record('t1', 'p1', block as never, 'start');
    expect(invokeMock).toHaveBeenLastCalledWith('record_block', expect.objectContaining({
      id: 'b1', sessionId: 't1', paneId: 'p1', command: 'ls', cwd: '/execution/path', exitCode: null, status: 'executing', endedAt: null,
    }));
    invokeMock.mockResolvedValueOnce(undefined);
    await sessionManager.record('t1', 'p1', block as never, 'complete');
    expect(invokeMock).toHaveBeenLastCalledWith('record_block', expect.objectContaining({
      id: 'b1', exitCode: 0, status: 'done', endedAt: 2, outputRaw: 'raw', outputClean: 'out', cwd: '/execution/path',
    }));
  });
});
