import { describe, it, expect, beforeEach } from 'vitest';
import { useChatStore } from './chat';

describe('chat store', () => {
  beforeEach(() => useChatStore.setState({ messages: [], sending: false }));

  it('send 追加用户消息并流式填充助手消息', async () => {
    const chunks = ['你好', '，世界', '！'];
    const fakeStream = async (_msgs: unknown, onChunk: (t: string) => void) => {
      for (const c of chunks) { onChunk(c); await Promise.resolve(); }
    };
    await useChatStore.getState().send('打个招呼', fakeStream);
    const msgs = useChatStore.getState().messages;
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toMatchObject({ role: 'user', content: '打个招呼' });
    expect(msgs[1]).toMatchObject({ role: 'assistant', content: '你好，世界！', pending: false });
  });

  it('流式失败时助手消息带错误提示', async () => {
    const failStream = async () => { throw new Error('boom'); };
    await useChatStore.getState().send('hi', failStream);
    const msgs = useChatStore.getState().messages;
    expect(msgs[1]!.content).toContain('出错了');
    expect(msgs[1]!.pending).toBe(false);
  });
});
