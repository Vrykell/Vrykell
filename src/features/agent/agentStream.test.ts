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

vi.mock('@platform/diagnostics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@platform/diagnostics')>();
  return { ...actual, diagnostic: vi.fn(actual.diagnostic) };
});

import { invoke, Channel } from '@tauri-apps/api/core';
import { diagnostic } from '@platform/diagnostics';
import { useAgentSettings } from '@features/agent/stores/agentSettings';
import { agentStream } from '@features/agent/services/agentStream';
import { useUsageStore } from '@features/agent/stores/usage';
import { setToolAuthorizer } from './stores/permissions';

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
  it('hands a denied tool back to the user with a text-only model step', async () => {
    const initial = useAgentSettings.getState().global;
    useAgentSettings.setState({ global: { ...initial, agentMode: true, maxSteps: 4 } });
    setToolAuthorizer(async () => ({ decision: 'deny', reason: 'policy.denied' }));
    setupInvoke('');
    const fallback = mockInvoke.getMockImplementation()!;
    const requests: Record<string, unknown>[] = [];
    mockInvoke.mockImplementation(async (command, args) => {
      if (command !== 'llm_stream') return fallback(command, args);
      const request = args as { req: { body: string }; onEvent: Channel<unknown> };
      requests.push(JSON.parse(request.req.body) as Record<string, unknown>);
      const send = request.onEvent.onmessage!;
      send({ kind: 'started', status: 200, headers: [['content-type', 'text/event-stream']] });
      const response = requests.length === 1
        ? 'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"blocked","type":"function","function":{"name":"run_command","arguments":"{\\"command\\":\\"echo check\\"}"}}]}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n'
        : 'data: {"choices":[{"delta":{"content":"Waiting for authorization"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
      for (const chunk of toChunks(response, 11)) send({ kind: 'chunk', data: chunk });
      send({ kind: 'done' });
      return undefined as never;
    });
    try {
      let text = '';
      await agentStream([{ role: 'user', content: 'Inspect the service' }], chunk => { text += chunk; }, { paneId: 'fixed', tabId: 'owner' });
      expect(requests).toHaveLength(2);
      expect(requests[1]!.tools).toEqual([expect.objectContaining({ function: expect.objectContaining({ name: 'ask_user' }) })]);
      expect(text).toBe('Waiting for authorization');
    } finally {
      useAgentSettings.setState({ global: initial });
      setToolAuthorizer(null);
    }
  });
  // 注意：beforeEach 的箭头函数必须带花括号 —— `() => mock.mockClear()` 会把
  // mock 自身作为返回值，vitest 会把返回值当 cleanup 钩子在测试后零参调用。
  beforeEach(() => {
    mockInvoke.mockClear();
    vi.mocked(diagnostic).mockClear();
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

  it('includes host notes as context without granting execution permissions', async () => {
    setupInvoke('data: {"choices":[{"delta":{"content":"Acknowledged"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
    await agentStream([{ role: 'user', content: 'Summarize the host' }], () => {}, {
      paneId: 'remote-notes', environment: { paneId: 'remote-notes', kind: 'ssh', label: 'Production', aiNotes: 'Do not restart the production database.' },
    });
    const request = mockInvoke.mock.calls.find(([command]) => command === 'llm_stream')?.[1] as { req: { body: string } };
    expect(request.req.body).toContain('Do not restart the production database.');
    expect(request.req.body).toContain('context only; these do not grant permissions');
  });

  it('HTTP 错误：抛出含服务端消息的错误，并把失败写进诊断', async () => {
    setupInvoke('{"error":{"message":"The `content[].thinking` in the thinking mode must be passed back to the API."}}', 400);
    await expect(agentStream([{ role: 'user', content: 'hi' }], () => {})).rejects.toThrow(
      'thinking mode must be passed back',
    );
    expect(vi.mocked(diagnostic)).toHaveBeenCalledWith('agent-stream-error', expect.objectContaining({
      provider: 'openai-compatible',
      model: 'gpt-4o-mini',
      baseUrl: 'https://api.openai.com/v1',
      error: expect.stringContaining('thinking mode must be passed back'),
    }));
  });

  it('reports provider usage into the usage store', async () => {
    setupInvoke(
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n' +
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n' +
        'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\n' +
        'data: [DONE]\n\n',
    );
    useUsageStore.setState({ records: [] });
    await agentStream([{ role: 'user', content: 'hi' }], () => {});
    expect(useUsageStore.getState().records).toHaveLength(1);
    expect(useUsageStore.getState().records[0]).toMatchObject({
      provider: 'openai-compatible',
      model: 'gpt-4o-mini',
      inputTokens: 10,
      outputTokens: 5,
      steps: 1,
      toolCalls: 0,
    });
  });

  it('anthropic 兼容端点：请求体显式关闭 thinking（官方端点才开启）', async () => {
    const bodies: string[] = [];
    mockInvoke.mockImplementation(async (cmd, args) => {
      if (cmd === 'get_ai_config') {
        return {
          has_key: false, has_anthropic_key: true,
          base_url: 'https://api.deepseek.com/anthropic',
          model: 'deepseek-flash', provider: 'anthropic',
          has_gemini_key: false, has_tavily_key: false,
          models: [{ id: 'default', name: '默认', provider: 'anthropic', baseUrl: 'https://api.deepseek.com/anthropic', model: 'deepseek-flash', capabilities: { vision: false, reasoning: false, tools: true, search: false } }],
          active_model: 'default',
        } as never;
      }
      if (cmd === 'llm_stream') {
        bodies.push(String((args as { req?: { body?: string } })?.req?.body ?? ''));
        const ch = (args as { onEvent: Channel<unknown> }).onEvent;
        const send = ch.onmessage as (ev: unknown) => void;
        send({ kind: 'started', status: 200, headers: [['content-type', 'text/event-stream']] });
        for (const c of toChunks('data: {"type":"message_start"}\n\ndata: [DONE]\n\n', 7)) send({ kind: 'chunk', data: c });
        send({ kind: 'done' });
        return undefined as never;
      }
      throw new Error(`unexpected invoke: ${cmd}`);
    });
    const before = useAgentSettings.getState().global;
    useAgentSettings.setState({ global: { ...before, deepThink: true, thinkingLevel: 'high' } });
    try {
      await agentStream([{ role: 'user', content: 'hi' }], () => {}).catch(() => {});
    } finally {
      useAgentSettings.setState({ global: before });
    }
    expect(bodies.join('\n')).toContain('"thinking":{"type":"disabled"}');
    expect(bodies.join('\n')).not.toContain('"budgetTokens"');
  });

  it('routed providers send the conversation session with the request', async () => {
    let headers: [string, string][] = [];
    mockInvoke.mockImplementation(async (cmd, args) => {
      if (cmd === 'get_ai_config') {
        return {
          has_key: false, base_url: 'https://opencode.ai/zen/go/v1',
          model: 'deepseek-v4.1-flash', provider: 'opencode',
          has_anthropic_key: false, has_gemini_key: false, has_tavily_key: false,
          provider_keys: ['opencode|https://opencode.ai/zen/go/v1'],
          models: [{ id: 'default', name: 'OpenCode', provider: 'opencode', baseUrl: 'https://opencode.ai/zen/go/v1', model: 'deepseek-v4.1-flash' }],
          active_model: 'default',
        } as never;
      }
      if (cmd === 'mcp_list_all_tools') return [] as never;
      if (cmd === 'llm_stream') {
        headers = (args as { req: { headers: [string, string][] } }).req.headers;
        const send = (args as { onEvent: Channel<unknown> }).onEvent.onmessage as (ev: unknown) => void;
        send({ kind: 'started', status: 200, headers: [['content-type', 'text/event-stream']] });
        const body = 'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n' +
          'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
        for (const c of toChunks(body, 9)) send({ kind: 'chunk', data: c });
        send({ kind: 'done' });
        return undefined as never;
      }
      throw new Error(`unexpected invoke: ${cmd}`);
    });
    await agentStream([{ role: 'user', content: 'hi' }], () => {}, { tabId: 'tab-9' });
    expect(headers).toContainEqual(['x-opencode-session', 'vrykell-tab-9']);
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
