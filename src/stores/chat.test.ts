import { describe, it, expect, beforeEach } from 'vitest';
import { useChatStore } from './chat';
import { useWorkspaceStore } from './workspace';

const initialChat = useChatStore.getState();
const initialWs = useWorkspaceStore.getState();

describe('chat store（按标签隔离）', () => {
  beforeEach(() => {
    useChatStore.setState(initialChat, true);
    useWorkspaceStore.setState(initialWs, true);
  });

  it('send 追加用户消息并流式填充助手消息', async () => {
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

  it('流式失败时助手消息带错误提示', async () => {
    const tabId = useWorkspaceStore.getState().activeId;
    const failStream = async () => { throw new Error('boom'); };
    await useChatStore.getState().send('hi', { streamFn: failStream });
    const msgs = useChatStore.getState().byTab[tabId]!;
    expect(msgs[1]!.content).toContain('出错了');
    expect(msgs[1]!.pending).toBe(false);
  });

  it('不同标签页的消息互不影响', async () => {
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

  it('首条消息自动命名标签', async () => {
    const noop = async (_m: unknown, _c: (t: string) => void) => {};
    await useChatStore.getState().send('量子力学是什么', { streamFn: noop });
    expect(useWorkspaceStore.getState().tabs[0]!.title).toBe('量子力学是什么');
  });

  it('appendDraft 累加草稿，send 后清空', async () => {
    const noop = async (_m: unknown, _c: (t: string) => void) => {};
    useChatStore.getState().appendDraft('/tmp/a.txt');
    useChatStore.getState().appendDraft('/tmp/b.txt');
    expect(useChatStore.getState().draft).toBe('/tmp/a.txt /tmp/b.txt');
    await useChatStore.getState().send('问题', { streamFn: noop });
    expect(useChatStore.getState().draft).toBe('');
  });

  it('send 携带 paneId 与 createdAt，错误时打 error 标记', async () => {
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

  it('send 缺省 paneId 时为 undefined（仅面板可见）', async () => {
    const tabId = useWorkspaceStore.getState().activeId;
    const noop = async (_m: unknown, _c: (t: string) => void) => {};
    await useChatStore.getState().send('无 pane', { streamFn: noop });
    expect(useChatStore.getState().byTab[tabId]![0]!.paneId).toBeUndefined();
  });
});

describe('chat store v2（parts / 工具事件）', () => {
  beforeEach(() => {
    useChatStore.setState(initialChat, true);
    useWorkspaceStore.setState(initialWs, true);
  });

  it('纯文本回答 parts 恒为 undefined（legacy 渲染契约）', async () => {
    const tabId = useWorkspaceStore.getState().activeId;
    const fake = async (_m: unknown, onChunk: (t: string) => void) => {
      onChunk('纯文本');
    };
    await useChatStore.getState().send('hi', { streamFn: fake });
    const assistant = useChatStore.getState().byTab[tabId]![1]!;
    expect(assistant.content).toBe('纯文本');
    expect(assistant.parts).toBeUndefined();
  });

  it('onToolEvent 惰性物化 parts，文本/工具保持时间序', async () => {
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
    // 合并补丁：startedAt 不被 undefined 覆盖，终态字段落上
    expect(tool).toMatchObject({ toolCallId: 't1', state: 'done', startedAt: 100, endedAt: 200 });
  });

  it('流式失败时未完结的工具落 error 终态', async () => {
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

  it('history 中助手消息追加工具摘要（模型可见本轮动作）', async () => {
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
    expect(prevAssistant.content).toContain('[执行命令: ls -la → 成功]');
    expect(tabId).toBeTruthy();
  });
});
