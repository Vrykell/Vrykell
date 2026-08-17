import { describe, it, expect, vi, beforeEach } from 'vitest';

const { invokeMock, listenMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  listenMock: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }));

import { anthropicStream } from './ai';

describe('anthropicStream', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    listenMock.mockReset();
  });

  it('后端报错时抛出错误', async () => {
    listenMock.mockResolvedValue(() => {});
    invokeMock.mockRejectedValue('尚未配置 API Key');
    await expect(anthropicStream([], () => {})).rejects.toThrow('尚未配置 API Key');
  });

  it('把 ai-chunk 事件逐块转发给 onChunk', async () => {
    let handler: ((e: { payload: { id: string; text: string } }) => void) | undefined;
    listenMock.mockImplementation(async (_event: string, cb: typeof handler) => {
      handler = cb;
      return () => {};
    });
    invokeMock.mockImplementation(async (_cmd: string, args: { id: string }) => {
      // 模拟后端逐块 emit，id 用真实调用参数，验证按 id 过滤
      handler?.({ payload: { id: args.id, text: '你好' } });
      handler?.({ payload: { id: args.id, text: '！' } });
      handler?.({ payload: { id: 'other-id', text: '（应被过滤）' } });
    });
    const got: string[] = [];
    await anthropicStream([{ role: 'user', content: 'hi' }], (t) => got.push(t));
    expect(got).toEqual(['你好', '！']);
    expect(invokeMock).toHaveBeenCalledWith('ai_stream', expect.objectContaining({
      messages: [{ role: 'user', content: 'hi' }],
    }));
  });
});
