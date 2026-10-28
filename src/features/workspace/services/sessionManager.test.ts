/**
 * sessionManager — session lifecycle (create/close/restore/rename/record and others) tests.
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

describe('sessionManager lifecycle', () => {
  it('moves pane chat ownership immediately and serializes history writes behind the transfer', async () => {
    let finish!: () => void;
    invokeMock.mockImplementation((command: string) => command === 'move_terminal_panes' ? new Promise<void>(resolve => { finish = resolve; }) : Promise.resolve(undefined));
    const message = (id: string, paneId?: string) => ({ id, paneId, role: 'user' as const, content: id, createdAt: 1 });
    useChatStore.setState({ byTab: { source: [message('legacy'), message('moving', 'source#1'), message('stay', 'source#2')], target: [message('existing', 'target#0')] } });
    const moving = sessionManager.transferPanes('source', 'target', ['source#0', 'source#1']);
    expect(useChatStore.getState().byTab.source!.map(message => message.id)).toEqual(['stay']);
    expect(useChatStore.getState().byTab.target!.map(message => message.id)).toEqual(['existing', 'legacy', 'moving']);
    expect(useChatStore.getState().byTab.target![1]!.paneId).toBe('source#0');
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    const closing = sessionManager.close('target');
    const settled = sessionManager.settlePaneTransfers(['source', 'target']);
    expect(invokeMock.mock.calls.some(([command]) => command === 'archive_session')).toBe(false);
    finish(); await Promise.all([moving, closing, settled]);
    expect(invokeMock.mock.calls.map(([command]) => command)).toEqual(['move_terminal_panes', 'archive_session']);
  });

  it('keeps a failed transfer retryable and avoids creating history for empty source drafts', async () => {
    invokeMock.mockResolvedValue(undefined);
    await sessionManager.create('empty-transfer', 'Draft');
    await sessionManager.transferPanes('empty-transfer', 'target', ['empty-transfer#0']);
    expect(invokeMock).not.toHaveBeenCalled();
    invokeMock.mockRejectedValueOnce(new Error('offline'));
    await expect(sessionManager.transferPanes('saved-source', 'saved-target', ['pane'])).rejects.toThrow('offline');
    await sessionManager.transferPanes('saved-source', 'saved-target', ['pane']);
    expect(invokeMock.mock.calls.filter(([command]) => command === 'move_terminal_panes')).toHaveLength(2);
  });
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

  it('close / rename / remove: passthrough and silent failure', async () => {
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

  it('restore: full rebuild (layout from payload; blocks by pane ownership; chat restored)', async () => {
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
    // block ownership: pane null -> #0
    expect(useBlockStore.getState().byTab[`${sessionId}#0`]).toHaveLength(1);
    const restored = useBlockStore.getState().byTab[`${sessionId}#0`]![0]!;
    expect(restored.outputText).toBe('out');
    expect(restored.cwd).toBe('/original/path');
    expect(useBlockStore.getState().byTab[`${sessionId}#1`]![0]!.cwd).toBe('/latest/path');
    expect(restored).not.toHaveProperty('collapsed');
    expect(invokeMock).not.toHaveBeenCalledWith('set_block_collapsed', expect.anything());
    expect(useBlockStore.getState().byTab[`${sessionId}#1`]).toHaveLength(1);
    // chat restored
    expect(useChatStore.getState().byTab[sessionId]).toHaveLength(2);
  });

  it('restore: clears chat when there are no blocks/chat; activates an existing tab', async () => {
    // simulate an existing active tab (the store no longer ships an initial tab)
    const sessionId = useSessionStore.getState().addTab({});
    invokeMock.mockResolvedValueOnce(undefined); // restore_session
    invokeMock.mockResolvedValueOnce([]); // blocks
    invokeMock.mockResolvedValueOnce([]); // chat
    invokeMock.mockResolvedValueOnce({ id: sessionId, title: 'x', kind: 'session', payload: 'garbage{{{', group_id: null, cwd: null, created_at: 1, updated_at: 2, archived_at: null }); // get_session
    await sessionManager.restore(sessionId, 'T');
    expect(useSessionStore.getState().activeId).toBe(sessionId);
    expect(useChatStore.getState().byTab[sessionId]).toBeUndefined();
  });

  it('record: start and complete passthrough', async () => {
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
