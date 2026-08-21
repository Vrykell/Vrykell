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
