/**
 * llmFetch — AI SDK provider 的自定义 fetch 适配器。
 *
 * LLM 请求不直接从 webview 发出：请求体经 invoke('llm_stream') 交给 Rust，
 * Rust 按目标 host 附加真实 API key 后发 HTTPS，响应字节流经 Channel 以
 * base64 块推回，这里再组装成标准 fetch Response 喂给 AI SDK。效果：
 *   - API key 永不进 webview 内存；
 *   - 不依赖 WebKit 的流式 fetch（老 macOS 兼容风险消除）。
 *
 * 取消语义：AI SDK abort signal / Response.body.cancel() 都会触发
 * llm_abort，Rust 侧用 AbortHandle 取消 reqwest 请求。
 */
import type { ProviderKind } from './provider';
import { sessionHeaderFor } from '@config/providers';
import { Channel } from '@tauri-apps/api/core';
import { invoke } from '@platform/diagnostics';

interface LlmStreamEvent {
  kind: 'started' | 'chunk' | 'done' | 'error';
  status?: number;
  headers?: [string, string][];
  /** base64 编码的原始字节（chunk 可能切断多字节 UTF-8，拼好再解码） */
  data?: string;
  message?: string;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Stable token for requests that are not tied to a conversation (titles, summaries). */
let fallbackSession: string | null = null;

function sessionToken(sessionId?: string): string {
  if (sessionId) return `vrykell-${sessionId}`;
  fallbackSession ??= `vrykell-${crypto.randomUUID()}`;
  return fallbackSession;
}

function normalizeHeaders(h?: HeadersInit): [string, string][] {
  if (!h) return [];
  if (h instanceof Headers) {
    const out: [string, string][] = [];
    h.forEach((v, k) => out.push([k, v]));
    return out;
  }
  if (Array.isArray(h)) return h.map(([k, v]) => [String(k), String(v)] as [string, string]);
  return Object.entries(h).map(([k, v]) => [k, String(v)] as [string, string]);
}

export function createProxyFetch(provider?: ProviderKind, sessionId?: string): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? 'POST';
    const headers = normalizeHeaders(init?.headers);
    if (!headers.some(([k]) => k.toLowerCase() === 'content-type')) {
      headers.push(['content-type', 'application/json']);
    }
    const sessionHeader = sessionHeaderFor(url);
    if (sessionHeader && !headers.some(([k]) => k.toLowerCase() === sessionHeader.toLowerCase())) {
      headers.push([sessionHeader, sessionToken(sessionId)]);
    }
    const body = typeof init?.body === 'string' ? init.body : undefined;
    const id = crypto.randomUUID();

    const channel = new Channel<LlmStreamEvent>();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    let startedResolve!: (v: { status: number; headers: Headers }) => void;
    let startedReject!: (e: Error) => void;
    const started = new Promise<{ status: number; headers: Headers }>((resolve, reject) => {
      startedResolve = resolve;
      startedReject = reject;
    });
    let settled = false;
    const finish = () => { settled = true; signal?.removeEventListener('abort', abort); };

    channel.onmessage = (ev) => {
      if (settled) return;
      try {
        switch (ev.kind) {
          case 'started':
            startedResolve({ status: ev.status ?? 200, headers: new Headers(ev.headers ?? []) });
            break;
          case 'chunk':
            controller.enqueue(base64ToBytes(ev.data ?? ''));
            break;
          case 'done':
            finish();
            controller.close();
            break;
          case 'error':
            finish();
            startedReject(new Error(ev.message ?? 'The model request failed.'));
            controller.error(new Error(ev.message ?? 'The model request failed.'));
            break;
        }
      } catch {
        // stream 已关闭/已取消时忽略迟到事件
      }
    };

    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
      cancel() {
        finish();
        invoke('llm_abort', { id }).catch(() => {});
      },
    });

    const abort = () => {
      if (settled) return;
      finish();
      invoke('llm_abort', { id }).catch(() => {});
      startedReject(new DOMException('The operation was aborted.', 'AbortError'));
      // Rust cancels the request and returns silently, without a terminal event, so the local
      // stream must settle here: a reader that never resolves would keep the consumer (the model
      // stream and the turn built on it) pending forever after an abort.
      try {
        controller.error(new DOMException('The operation was aborted.', 'AbortError'));
      } catch {
        // stream already closed or errored
      }
    };
    if (signal) {
      signal.addEventListener('abort', abort, { once: true });
    }

    invoke('llm_stream', { id, req: { url, method, headers, body, provider }, onEvent: channel }).catch(
      (e) => {
        if (settled) return;
        finish();
        console.error('[llmFetch] llm_stream 调用被 Rust 拒绝:', url, e);
        const err = e instanceof Error ? e : new Error(String(e));
        startedReject(err);
        try {
          controller.error(err);
        } catch {
          // 已关闭
        }
      },
    );

    const { status, headers: respHeaders } = await started;
    // Response 构造器要求 status ∈ [200, 599]；异常值兜底为 502
    const safeStatus = status >= 200 && status <= 599 ? status : 502;
    // 204/304 不允许带 body
    const noBody = safeStatus === 204 || safeStatus === 304;
    return new Response(noBody ? null : stream, { status: safeStatus, headers: respHeaders });
  }) as typeof fetch;
}
