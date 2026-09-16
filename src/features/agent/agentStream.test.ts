/**
 * agentStream 端到端链路测试：真实 AI SDK + 真实 llmFetch 适配器 + 真实 provider 工厂，
 * 只 mock Tauri IPC 边界（invoke/Channel），投递罐头 OpenAI SSE 字节流。
 * 验证 v7 API 用法与适配器组装是否正确。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => {
  class MockChannel {
    onmessage: ((ev: unknown) => void) | null = null;
  }
  return {
    Channel: MockChannel,
    invoke: vi.fn(),
  };
});

import { invoke, Channel } from '@tauri-apps/api/core';
import { agentStream } from '@features/agent/agentStream';

const mockInvoke = vi.mocked(invoke);

/** 把字符串按字节切成 base64 块（模拟 Rust 侧任意 chunk 边界） */
function toChunks(s: string, size: number): string[] {
  const bytes = new TextEncoder().encode(s);
  const out: string[] = [];
  for (let i = 0; i < bytes.length; i += size) {
    const slice = bytes.slice(i, i + size);
    out.push(btoa(String.fromCharCode(...slice)));
  }
  return out;
}

function setupInvoke(sseBody: string, status = 200) {
  mockInvoke.mockImplementation(async (...rest) => {
    const [cmd, args] = rest as [string, { onEvent: Channel<unknown> } | undefined];
    console.log('INVOKE>', String(cmd), rest.length, JSON.stringify(args)?.slice(0, 100));
    if (cmd === 'get_ai_config') {
      return {
        has_key: true,
        base_url: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        provider: 'openai-compatible',
        has_anthropic_key: false,
        has_gemini_key: false,
        has_tavily_key: false,
        models: [{ id: 'default', name: '默认', provider: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', capabilities: { vision: false, reasoning: false, tools: true, search: false } }],
        active_model: 'default',
      } as never;
    }
    if (cmd === 'llm_stream') {
      const ch = (args as { onEvent: Channel<unknown> }).onEvent;
      const send = ch.onmessage as (ev: unknown) => void;
      send({ kind: 'started', status, headers: [['content-type', 'text/event-stream']] });
      // 7 字节一块，故意切断多字节字符与 SSE 行
      for (const c of toChunks(sseBody, 7)) send({ kind: 'chunk', data: c });
      send({ kind: 'done' });
      return undefined as never;
    }
    throw new Error(`unexpected invoke: ${cmd}`);
  });
}

describe('agentStream（mock IPC 边界）', () => {
  // 注意：beforeEach 的箭头函数必须带花括号 —— `() => mock.mockClear()` 会把
  // mock 自身作为返回值，vitest 会把返回值当 cleanup 钩子在测试后零参调用。
  beforeEach(() => {
    mockInvoke.mockClear();
  });

  it('正常流式：onChunk 收到完整文本', async () => {
    setupInvoke(
      'data: {"choices":[{"delta":{"content":"你好"}}]}\n\n' +
        'data: {"choices":[{"delta":{"content":"，世界"},"finish_reason":"stop"}]}\n\n' +
        'data: [DONE]\n\n',
    );
    let text = '';
    await agentStream([{ role: 'user', content: 'hi' }], (c) => (text += c));
    expect(text).toBe('你好，世界');
  });

  it('HTTP 错误：抛出含服务端消息的错误', async () => {
    setupInvoke('{"error":{"message":"invalid key"}}', 401);
    await expect(agentStream([{ role: 'user', content: 'hi' }], () => {})).rejects.toThrow(
      'invalid key',
    );
  });

  it('未配 key：抛中文提示', async () => {
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === 'get_ai_config') {
        return {
          has_key: false,
          base_url: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini',
          provider: 'openai-compatible',
          has_anthropic_key: false,
          has_gemini_key: false,
          has_tavily_key: false,
        } as never;
      }
      throw new Error(`unexpected invoke: ${cmd}`);
    });
    await expect(agentStream([{ role: 'user', content: 'hi' }], () => {})).rejects.toThrow(
      '尚未配置 API Key',
    );
  });
});
