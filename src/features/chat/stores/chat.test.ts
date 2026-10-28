import { describe, it, expect, beforeEach } from 'vitest';
import { useChatStore, setDefaultStream } from '@features/chat/stores/chat';
import { useWorkspaceStore } from '@features/workspace/stores/workspace';

const initialChat = useChatStore.getState();
const initialWs = useWorkspaceStore.getState();

describe('chat store (isolated per tab)', () => {
  beforeEach(() => {
    useChatStore.setState(initialChat, true);
    useWorkspaceStore.setState(initialWs, true);
  });

  it('send appends the user message and streams the assistant reply', async () => {
    const tabId = useWorkspaceStore.getState().activeId;
    const chunks = ['你好', '，世界', '！'];
    const fakeStream = async (_msgs: unknown, onChunk: (t: string) => void) => {
      for (const c of chunks) { onChunk(c); await Promise.resolve(); }
    };
    await useChatStore.getState().send('打个招呼', { streamFn: fakeStream });
    const msgs = useChatStore.getState().byTab[tabId]!;
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toMatchObject({ role: 'user', content: '打个招呼' });
    expect(msgs[1]).toMatchObject({ role: 'assistant', content: '你好，世界！', pending: false });
  });

  it('keeps the error on the assistant message when streaming fails', async () => {
    const tabId = useWorkspaceStore.getState().activeId;
    const failStream = async () => { throw new Error('boom'); };
    await useChatStore.getState().send('hi', { streamFn: failStream });
    const msgs = useChatStore.getState().byTab[tabId]!;
    expect(msgs[1]!.content).not.toContain('出错了');
    expect(msgs[1]!.errorText).toBe('boom');
    expect(msgs[1]!.pending).toBe(false);
  });

  it('keeps messages of different tabs independent', async () => {
    const t1 = useWorkspaceStore.getState().activeId;
    const noop = async (_m: unknown, _c: (t: string) => void) => {};
    await useChatStore.getState().send('标签一的消息', { streamFn: noop });
    useWorkspaceStore.getState().addTab();
    const t2 = useWorkspaceStore.getState().activeId;
    expect(t2).not.toBe(t1);
    expect(useChatStore.getState().byTab[t2]).toBeUndefined();
    await useChatStore.getState().send('标签二的消息', { streamFn: noop });
    expect(useChatStore.getState().byTab[t1]).toHaveLength(2);
    expect(useChatStore.getState().byTab[t2]).toHaveLength(2);
  });

  it('names the tab from the first message', async () => {
    // Simulate the tab that exists after startup (the store no longer seeds one)
    useWorkspaceStore.getState().addTab({});
    const noop = async (_m: unknown, _c: (t: string) => void) => {};
    await useChatStore.getState().send('量子力学是什么', { streamFn: noop });
    expect(useWorkspaceStore.getState().tabs[0]!.title).toBe('量子力学是什么');
  });

  it('appendDraft appends to the draft and send clears it', async () => {
    const noop = async (_m: unknown, _c: (t: string) => void) => {};
    useChatStore.getState().appendDraft('/tmp/a.txt');
    useChatStore.getState().appendDraft('/tmp/b.txt');
    expect(useChatStore.getState().draft).toBe('/tmp/a.txt /tmp/b.txt');
    await useChatStore.getState().send('问题', { streamFn: noop });
    expect(useChatStore.getState().draft).toBe('');
  });

  it('send carries paneId and createdAt and flags errors', async () => {
    const tabId = useWorkspaceStore.getState().activeId;
    const noop = async (_m: unknown, _c: (t: string) => void) => {};
    await useChatStore.getState().send('pane 的问题', { streamFn: noop, paneId: 'pane-1' });
    const msgs = useChatStore.getState().byTab[tabId]!;
    expect(msgs[0]).toMatchObject({ role: 'user', paneId: 'pane-1' });
    expect(typeof msgs[0]!.createdAt).toBe('number');
    expect(msgs[1]).toMatchObject({ role: 'assistant', paneId: 'pane-1', error: undefined });

    const fail = async () => { throw new Error('boom'); };
    await useChatStore.getState().send('会失败', { streamFn: fail });
    const after = useChatStore.getState().byTab[tabId]!;
    expect(after[after.length - 1]!.error).toBe(true);
  });

  it('leaves paneId undefined when omitted so the message stays panel-only', async () => {
    const tabId = useWorkspaceStore.getState().activeId;
    const noop = async (_m: unknown, _c: (t: string) => void) => {};
    await useChatStore.getState().send('无 pane', { streamFn: noop });
    expect(useChatStore.getState().byTab[tabId]![0]!.paneId).toBeUndefined();
  });
});

describe('chat store v2 (parts / tool events)', () => {
  beforeEach(() => {
    useChatStore.setState(initialChat, true);
    useWorkspaceStore.setState(initialWs, true);
    // Simulate the active tab that exists after startup (the store no longer seeds one)
    useWorkspaceStore.getState().addTab({});
  });

  it('keeps parts undefined for plain-text answers (legacy rendering contract)', async () => {
    const tabId = useWorkspaceStore.getState().activeId;
    const fake = async (_m: unknown, onChunk: (t: string) => void) => {
      onChunk('纯文本');
    };
    await useChatStore.getState().send('hi', { streamFn: fake });
    const assistant = useChatStore.getState().byTab[tabId]![1]!;
    expect(assistant.content).toBe('纯文本');
    expect(assistant.parts).toBeUndefined();
  });

  it('materializes parts lazily from onToolEvent and keeps text and tools in time order', async () => {
    const tabId = useWorkspaceStore.getState().activeId;
    const fake = async (
      _m: unknown,
      onChunk: (t: string) => void,
      ctx?: { handlers?: { onToolEvent?: (run: never) => void } },
    ) => {
      onChunk('先看看');
      ctx?.handlers?.onToolEvent?.({
        toolCallId: 't1',
        toolName: 'run_command',
        input: { command: 'ls' },
        state: 'running',
        startedAt: 100,
      } as never);
      onChunk('执行完了');
      ctx?.handlers?.onToolEvent?.({
        toolCallId: 't1',
        toolName: 'run_command',
        input: { command: 'ls' },
        state: 'done',
        output: '{"ok":true}',
        startedAt: undefined,
        endedAt: 200,
      } as never);
    };
    await useChatStore.getState().send('跑个命令', { streamFn: fake });
    const assistant = useChatStore.getState().byTab[tabId]![1]!;
    expect(assistant.content).toBe('先看看执行完了');
    const parts = assistant.parts!;
    expect(parts).toHaveLength(3);
    expect(parts[0]).toEqual({ kind: 'text', text: '先看看' });
    expect(parts[2]).toEqual({ kind: 'text', text: '执行完了' });
    const tool = parts[1]!.kind === 'tool' ? parts[1]!.tool : null;
    // Merge patch: startedAt is not overwritten by undefined and the terminal fields land
    expect(tool).toMatchObject({ toolCallId: 't1', state: 'done', startedAt: 100, endedAt: 200 });
  });

  it('moves unfinished tools to the error terminal state when streaming fails', async () => {
    const tabId = useWorkspaceStore.getState().activeId;
    const fail = async (
      _m: unknown,
      _c: (t: string) => void,
      ctx?: { handlers?: { onToolEvent?: (run: never) => void } },
    ) => {
      ctx?.handlers?.onToolEvent?.({
        toolCallId: 't9',
        toolName: 'run_command',
        input: { command: 'rm x' },
        state: 'running',
        startedAt: 1,
      } as never);
      throw new Error('boom');
    };
    await useChatStore.getState().send('hi', { streamFn: fail });
    const assistant = useChatStore.getState().byTab[tabId]![1]!;
    expect(assistant.error).toBe(true);
    const tool = assistant.parts![0]!.kind === 'tool' ? assistant.parts![0]!.tool : null;
    expect(tool!.state).toBe('error');
    expect(tool!.endedAt).toBeDefined();
  });

  it('appends a tool summary to the assistant history so the model sees the round actions', async () => {
    const tabId = useWorkspaceStore.getState().activeId;
    const first = async (
      _m: unknown,
      _c: (t: string) => void,
      ctx?: { handlers?: { onToolEvent?: (run: never) => void } },
    ) => {
      ctx?.handlers?.onToolEvent?.({
        toolCallId: 't1',
        toolName: 'run_command',
        input: { command: 'ls -la' },
        state: 'done',
        startedAt: 1,
        endedAt: 2,
      } as never);
    };
    await useChatStore.getState().send('第一轮', { streamFn: first });
    let seen: Array<{ role: string; content: string }> = [];
    const second = async (msgs: Array<{ role: string; content: string }>) => {
      seen = msgs;
    };
    await useChatStore.getState().send('第二轮', { streamFn: second });
    const prevAssistant = seen.find((m) => m.role === 'assistant')!;
    expect(prevAssistant).toMatchObject({ parts: [{ kind: 'tool', tool: { toolCallId: 't1', input: { command: 'ls -la' } } }] });
    expect(tabId).toBeTruthy();
  });
});

describe('chat store M4 (stop / regenerate / edit-resend / delete)', () => {
  beforeEach(() => {
    useChatStore.setState(initialChat, true);
    useWorkspaceStore.setState(initialWs, true);
    // Simulate the active tab that exists after startup (the store no longer seeds one)
    useWorkspaceStore.getState().addTab({});
  });

  it('regenerate removes the old answer, streams a new one in place and cuts history at that question', async () => {
    const tabId = useWorkspaceStore.getState().activeId;
    const first = async (_m: unknown, onChunk: (t: string) => void) => { onChunk('旧答案'); };
    await useChatStore.getState().send('问题一', { streamFn: first });
    const userMsgId = useChatStore.getState().byTab[tabId]![0]!.id;
    const oldAnswerId = useChatStore.getState().byTab[tabId]![1]!.id;

    let seen: Array<{ role: string; content: string }> = [];
    setDefaultStream(async (msgs, onChunk) => {
      seen = msgs;
      onChunk('新答案');
    });
    await useChatStore.getState().regenerate(tabId, userMsgId);

    const msgs = useChatStore.getState().byTab[tabId]!;
    // Still two messages: the old answer was replaced, not appended
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toMatchObject({ id: userMsgId, role: 'user' });
    expect(msgs[1]).toMatchObject({ role: 'assistant', content: '新答案', pending: false });
    expect(msgs[1]!.id).not.toBe(oldAnswerId);
    // History ends at that question (the old answer is excluded)
    expect(seen).toEqual([{ role: 'user', content: '问题一' }]);
    expect(useChatStore.getState().sendingTabs).toEqual([]);
  });

  it('regenerate takes only the history up to the target question', async () => {
    const tabId = useWorkspaceStore.getState().activeId;
    const mk = (answer: string) => async (_m: unknown, onChunk: (t: string) => void) => { onChunk(answer); };
    await useChatStore.getState().send('问一', { streamFn: mk('答一') });
    await useChatStore.getState().send('问二', { streamFn: mk('答二') });
    const firstUserId = useChatStore.getState().byTab[tabId]![0]!.id;

    let seen: Array<{ role: string; content: string }> = [];
    setDefaultStream(async (msgs, onChunk) => { seen = msgs; onChunk('重生一'); });
    await useChatStore.getState().regenerate(tabId, firstUserId);

    // Only the answer to the target question is replaced; later exchanges stay (but are not part of this history)
    const msgs = useChatStore.getState().byTab[tabId]!;
    expect(msgs.map((m) => m.content)).toEqual(['问一', '重生一', '问二', '答二']);
    expect(seen).toEqual([{ role: 'user', content: '问一' }]);
  });

  it('deleteExchange removes the question and the answer after it, leaving other exchanges untouched', async () => {
    const tabId = useWorkspaceStore.getState().activeId;
    const mk = (answer: string) => async (_m: unknown, onChunk: (t: string) => void) => { onChunk(answer); };
    await useChatStore.getState().send('问一', { streamFn: mk('答一') });
    await useChatStore.getState().send('问二', { streamFn: mk('答二') });
    const firstUserId = useChatStore.getState().byTab[tabId]![0]!.id;

    useChatStore.getState().deleteExchange(tabId, firstUserId);
    const msgs = useChatStore.getState().byTab[tabId]!;
    expect(msgs.map((m) => m.content)).toEqual(['问二', '答二']);
  });

  it('editResend removes that message and everything after it and refills the draft with the question', async () => {
    const tabId = useWorkspaceStore.getState().activeId;
    const mk = (answer: string) => async (_m: unknown, onChunk: (t: string) => void) => { onChunk(answer); };
    await useChatStore.getState().send('问一', { streamFn: mk('答一') });
    await useChatStore.getState().send('问二', { streamFn: mk('答二') });
    const firstUserId = useChatStore.getState().byTab[tabId]![0]!.id;

    useChatStore.getState().editResend(tabId, firstUserId);
    expect(useChatStore.getState().byTab[tabId] ?? []).toEqual([]);
    expect(useChatStore.getState().draft).toBe('问一');
  });

  it('stop keeps the partial content on abort without flagging an error or appending error text', async () => {
    const tabId = useWorkspaceStore.getState().activeId;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const stopStream = async (
      _m: unknown,
      onChunk: (t: string) => void,
      _ctx?: unknown,
    ) => {
      onChunk('半截回答');
      await gate;
      throw new Error('aborted');
    };
    const p = useChatStore.getState().send('会慢慢说', { streamFn: stopStream });
    // Wait for the 50 ms batched flush to land in the store before stopping
    await new Promise((r) => setTimeout(r, 80));
    useChatStore.getState().abortStream(tabId);
    release();
    await p;

    const msgs = useChatStore.getState().byTab[tabId]!;
    expect(msgs).toHaveLength(2);
    expect(msgs[1]).toMatchObject({ role: 'assistant', content: '半截回答', pending: false });
    expect(msgs[1]!.error).toBeUndefined();
    expect(msgs[1]!.errorText).toBeUndefined();
    expect(useChatStore.getState().sendingTabs).toEqual([]);
  });

  it('removes the empty shell answer when stopped immediately (no empty bubble)', async () => {
    const tabId = useWorkspaceStore.getState().activeId;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const stopStream = async () => { await gate; throw new Error('aborted'); };
    const p = useChatStore.getState().send('还没说就停', { streamFn: stopStream });
    useChatStore.getState().abortStream(tabId);
    release();
    await p;

    const msgs = useChatStore.getState().byTab[tabId]!;
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.role).toBe('user');
  });

  it('blocks edits to the owner while its stream is active', async () => {
    const tabId = useWorkspaceStore.getState().activeId;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const slow = async (_m: unknown, onChunk: (t: string) => void) => {
      onChunk('答');
      await gate;
    };
    const p = useChatStore.getState().send('问', { streamFn: slow });
    const userMsgId = useChatStore.getState().byTab[tabId]![0]!.id;

    useChatStore.getState().deleteExchange(tabId, userMsgId);
    useChatStore.getState().editResend(tabId, userMsgId);
    void useChatStore.getState().regenerate(tabId, userMsgId);
    expect(useChatStore.getState().byTab[tabId]).toHaveLength(2);
    expect(useChatStore.getState().draft).toBe('');

    useChatStore.getState().abortStream(tabId);
    release();
    await p;
  });
});
