import { describe, it, expect, vi, beforeEach } from 'vitest';

const { streamMock } = vi.hoisted(() => ({ streamMock: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { stream: streamMock };
    constructor(public opts: unknown) {}
  },
}));

import { anthropicStream } from './ai';

describe('anthropicStream', () => {
  beforeEach(() => { localStorage.clear(); streamMock.mockReset(); });

  it('未配置 key 时抛出中文错误', async () => {
    await expect(anthropicStream([], () => {})).rejects.toThrow('API Key');
  });

  it('把 text_delta 事件逐块转发给 onChunk', async () => {
    localStorage.setItem('ai-terminal-api-key', 'sk-test');
    streamMock.mockReturnValue((async function* () {
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: '你好' } };
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: '！' } };
      yield { type: 'message_stop' };
    })());
    const got: string[] = [];
    await anthropicStream([{ role: 'user', content: 'hi' }], (t) => got.push(t));
    expect(got).toEqual(['你好', '！']);
    expect(streamMock).toHaveBeenCalledWith(expect.objectContaining({
      messages: [{ role: 'user', content: 'hi' }],
    }));
  });
});
