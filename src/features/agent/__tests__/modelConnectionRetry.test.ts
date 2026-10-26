import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke, Channel } from '@tauri-apps/api/core';
import { agentStream } from '../services/agentStream';
import { useAgentSettings } from '../stores/agentSettings';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  Channel: class { onmessage: ((event: unknown) => void) | null = null; },
}));

const initial = useAgentSettings.getState();
const invokeMock = vi.mocked(invoke);
let attempts = 0;
let respond: (send: (event: unknown) => void) => void;
const success = (send: (event: unknown) => void) => {
  send({ kind: 'started', status: 200, headers: [['content-type', 'text/event-stream']] });
  send({ kind: 'chunk', data: btoa('data: {"choices":[{"delta":{"content":"Recovered"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n') });
  send({ kind: 'done' });
};

beforeEach(() => {
  vi.useFakeTimers(); attempts = 0;
  useAgentSettings.setState({ global: { ...initial.global, agentMode: false } });
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (command, args) => {
    if (command === 'get_ai_config') return {
      has_key: true, provider: 'openai-compatible', base_url: 'https://api.example.com/v1', model: 'test',
      models: [], active_model: 'test',
    } as never;
    if (command === 'llm_stream') {
      attempts++;
      respond((args as { onEvent: Channel<unknown> }).onEvent.onmessage!);
    }
    return undefined as never;
  });
});
afterEach(() => { vi.useRealTimers(); useAgentSettings.setState(initial, true); });

it('retries connection failures twice with backoff and preserves a single reply', async () => {
  respond = send => attempts < 3 ? send({ kind: 'error', retryable: true, message: 'Connection reset' }) : success(send);
  const chunk = vi.fn();
  const running = agentStream([{ role: 'user', content: 'Hello' }], chunk);
  await vi.waitFor(() => expect(attempts).toBe(1));
  expect(chunk).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(2000);
  expect(attempts).toBe(2);
  await vi.advanceTimersByTimeAsync(4000);
  await running;
  expect(attempts).toBe(3);
  expect(chunk).toHaveBeenCalledExactlyOnceWith('Recovered');
});

it('reports the final failure after three attempts', async () => {
  respond = send => send({ kind: 'error', retryable: true, message: 'Connection unavailable' });
  const running = agentStream([{ role: 'user', content: 'Hello' }], () => {});
  const failed = expect(running).rejects.toThrow('Connection unavailable');
  await vi.advanceTimersByTimeAsync(7000);
  await failed;
  expect(attempts).toBe(3);
});

it('stops during retry backoff without starting another request', async () => {
  respond = send => send({ kind: 'error', retryable: true, message: 'Connection reset' });
  const controller = new AbortController();
  const running = agentStream([{ role: 'user', content: 'Hello' }], () => {}, { signal: controller.signal });
  await vi.waitFor(() => expect(attempts).toBe(1));
  controller.abort();
  await running.catch(() => {});
  await vi.advanceTimersByTimeAsync(10_000);
  expect(attempts).toBe(1);
});

it('does not retry authentication failures', async () => {
  respond = send => {
    send({ kind: 'started', status: 401, headers: [['content-type', 'application/json']] });
    send({ kind: 'chunk', data: btoa('{"error":{"message":"Invalid API key"}}') });
    send({ kind: 'done' });
  };
  await expect(agentStream([{ role: 'user', content: 'Hello' }], () => {})).rejects.toThrow('Invalid API key');
  expect(attempts).toBe(1);
});

it('does not replay a response after streaming has started', async () => {
  respond = send => {
    send({ kind: 'started', status: 200, headers: [['content-type', 'text/event-stream']] });
    send({ kind: 'chunk', data: btoa('data: {"choices":[{"delta":{"content":"Partial"}}]}\n\n') });
    queueMicrotask(() => send({ kind: 'error', retryable: true, message: 'Connection lost while reading' }));
  };
  await expect(agentStream([{ role: 'user', content: 'Hello' }], () => {})).rejects.toThrow('Connection lost while reading');
  expect(attempts).toBe(1);
});
