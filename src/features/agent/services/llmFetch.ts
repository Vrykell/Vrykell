/**
 * llmFetch — custom fetch adapter for the model provider.
 *
 * Model requests never leave the webview directly: the request body goes to the backend through
 * invoke('llm_stream'); the backend attaches the real API key for the target host and sends HTTPS,
 * then pushes the response bytes back through a Channel as base64 chunks, which this adapter
 * reassembles into a standard fetch Response for the model SDK. Benefits:
 *   - the API key never enters webview memory;
 *   - no dependence on the system webview's streaming fetch (removes compatibility risk on older macOS).
 *
 * Cancellation: a model SDK abort signal or Response.body.cancel() both trigger llm_abort; the
 * backend cancels the HTTP request with an AbortHandle.
 */
import type { ProviderKind } from './provider';
import { sessionHeaderFor } from '@config/providers';
import { Channel } from '@tauri-apps/api/core';
import { invoke } from '@platform/diagnostics';
import { APICallError } from 'ai';
import { t } from '@i18n';

interface LlmStreamEvent {
  kind: 'started' | 'chunk' | 'done' | 'error';
  status?: number;
  headers?: [string, string][];
  /** Base64-encoded raw bytes (a chunk may split a multi-byte UTF-8 sequence; join before decoding). */
  data?: string;
  message?: string;
  retryable?: boolean;
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
    let responseStarted = false;
    const finish = () => { settled = true; signal?.removeEventListener('abort', abort); };

    channel.onmessage = (ev) => {
      if (settled) return;
      try {
        switch (ev.kind) {
          case 'started':
            responseStarted = true;
            startedResolve({ status: ev.status ?? 200, headers: new Headers(ev.headers ?? []) });
            break;
          case 'chunk':
            controller.enqueue(base64ToBytes(ev.data ?? ''));
            break;
          case 'done':
            finish();
            controller.close();
            break;
          case 'error': {
            finish();
            const message = ev.message ?? t('The model request failed.');
            const error = new APICallError({
              message: !responseStarted && ev.retryable !== undefined
                ? t('Could not connect to the model service: {{message}}', { message }) : message,
              url, requestBodyValues: undefined, isRetryable: !responseStarted && ev.retryable === true,
            });
            startedReject(error);
            controller.error(error);
            break;
          }
        }
      } catch {
        // Ignore late events once the stream is closed or cancelled.
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
          // already closed
        }
      },
    );

    const { status, headers: respHeaders } = await started;
    // The Response constructor requires status ∈ [200, 599]; fall back to 502 for invalid values.
    const safeStatus = status >= 200 && status <= 599 ? status : 502;
    // 204/304 must not carry a body.
    const noBody = safeStatus === 204 || safeStatus === 304;
    return new Response(noBody ? null : stream, { status: safeStatus, headers: respHeaders });
  }) as typeof fetch;
}
