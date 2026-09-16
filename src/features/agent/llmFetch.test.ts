/**
 * llmFetch — Rust 代理 fetch 适配器测试（started/chunk/done/error 事件流）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
  Channel: class {
    onmessage: ((ev: unknown) => void) | null = null;
    constructor() { this.onmessage = null; }
    send(ev: unknown) { this.onmessage?.(ev); }
  },
}));

import { createProxyFetch } from '@features/agent/services/llmFetch';

const fetchProxy = createProxyFetch();

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation(() => Promise.resolve());
});

describe('createProxyFetch', () => {
  it('started + chunk + done：组装响应并解码 base64 字节', async () => {
    invokeMock.mockImplementation((_cmd: string, args: { onEvent: { send: (ev: unknown) => void } }) => {
      args.onEvent.send({ kind: 'started', status: 200, headers: [['content-type', 'text/plain']] });
      args.onEvent.send({ kind: 'chunk', data: 'aGVsbG8=' }); // "hello"
      args.onEvent.send({ kind: 'done' });
      return Promise.resolve();
    });
    const res = await fetchProxy('https://api.example.com/v1/chat');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/plain');
    expect(await res.text()).toBe('hello');
    expect(invokeMock).toHaveBeenCalledWith('llm_stream', expect.objectContaining({
      req: expect.objectContaining({
        url: 'https://api.example.com/v1/chat',
        method: 'POST',
        headers: expect.arrayContaining([['content-type', 'application/json']]),
      }),
    }));
  });

  it('URL/Request 输入与显式 method/body；已有 content-type 不重复添加', async () => {
    invokeMock.mockImplementation((_cmd: string, args: { req: { method: string; headers: [string, string][] }; onEvent: { send: (ev: unknown) => void } }) => {
      expect(args.req.method).toBe('GET');
      expect(args.req.headers).toEqual([['accept', 'application/json'], ['content-type', 'application/json']]);
      args.onEvent.send({ kind: 'started', status: 200 });
      args.onEvent.send({ kind: 'done' });
      return Promise.resolve();
    });
    const res = await fetchProxy(new URL('https://x.example/api'), {
      method: 'GET',
      headers: new Headers({ accept: 'application/json' }),
    });
    expect(res.status).toBe(200);
    // 数组 headers + body 字符串
    invokeMock.mockImplementation((_cmd: string, args: { req: { headers: [string, string][]; body?: string }; onEvent: { send: (ev: unknown) => void } }) => {
      expect(args.req.headers).toEqual([['content-type', 'application/json']]);
      expect(args.req.body).toBe('{"q":1}');
      args.onEvent.send({ kind: 'started', status: 200 });
      args.onEvent.send({ kind: 'done' });
      return Promise.resolve();
    });
    await fetchProxy('https://x.example/api', { headers: [], body: '{"q":1}' });
  });

  it('非标准 status 兜底 502；204 不带 body', async () => {
    invokeMock.mockImplementation((_cmd: string, args: { onEvent: { send: (ev: unknown) => void } }) => {
      args.onEvent.send({ kind: 'started', status: 600 });
      args.onEvent.send({ kind: 'done' });
      return Promise.resolve();
    });
    const res = await fetchProxy('https://x.example');
    expect(res.status).toBe(502);
    invokeMock.mockImplementation((_cmd: string, args: { onEvent: { send: (ev: unknown) => void } }) => {
      args.onEvent.send({ kind: 'started', status: 204 });
      return Promise.resolve();
    });
    const noBody = await fetchProxy('https://x.example');
    expect(noBody.status).toBe(204);
    expect(noBody.body).toBeNull();
  });

  it('error 事件：流以错误结束', async () => {
    invokeMock.mockImplementation((_cmd: string, args: { onEvent: { send: (ev: unknown) => void } }) => {
      args.onEvent.send({ kind: 'started', status: 200 });
      args.onEvent.send({ kind: 'error', message: '上游 429' });
      return Promise.resolve();
    });
    const res = await fetchProxy('https://x.example');
    await expect(res.text()).rejects.toThrow('上游 429');
  });

  it('invoke 被拒：fetch 整体拒绝', async () => {
    invokeMock.mockRejectedValue(new Error('Rust 拒绝'));
    await expect(fetchProxy('https://x.example')).rejects.toThrow('Rust 拒绝');
    expect(invokeMock).toHaveBeenCalledWith('llm_stream', expect.objectContaining({
      req: expect.objectContaining({ url: 'https://x.example' }),
    }));
  });

  it('signal 已中止：直接抛 AbortError 并触发 llm_abort', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(fetchProxy('https://x.example', { signal: ctrl.signal })).rejects.toThrow('aborted');
    expect(invokeMock).toHaveBeenCalledWith('llm_abort', expect.objectContaining({ id: expect.any(String) }));
  });
});
