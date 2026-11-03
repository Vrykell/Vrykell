import { afterEach, expect, it, vi } from 'vitest';
import { batchAcpEvents, type AcpSessionEvent } from '../api/acp';

const text = (value: string, sessionId = 'session'): AcpSessionEvent => ({ sessionId, kind: 'update',
  payload: { params: { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: value } } } } });
afterEach(() => vi.useRealTimers());

it('batches adjacent chunks and flushes the complete reply before stop without mutating input', async () => {
  vi.useFakeTimers();
  const received: AcpSessionEvent[] = [];
  const batch = batchAcpEvents(event => received.push(event));
  const first = text('Hello');
  batch.push(first); batch.push(text(' world'));
  expect(received).toEqual([]);
  const stop: AcpSessionEvent = { sessionId: 'session', kind: 'stop', payload: { stopReason: 'end_turn' } };
  batch.push(stop);
  expect(received).toEqual([text('Hello world'), stop]);
  expect(first).toEqual(text('Hello'));
  await vi.advanceTimersByTimeAsync(50);
  expect(received).toHaveLength(2);
});

it('preserves session and permission boundaries, flushes on time and discards disposed chunks', async () => {
  vi.useFakeTimers();
  const received: AcpSessionEvent[] = [];
  const batch = batchAcpEvents(event => received.push(event));
  batch.push(text('first')); batch.push(text('second', 'other'));
  const permission: AcpSessionEvent = { sessionId: 'other', kind: 'permission', payload: {} };
  batch.push(permission);
  expect(received).toEqual([text('first'), text('second', 'other'), permission]);
  batch.push(text('timed')); await vi.advanceTimersByTimeAsync(50);
  expect(received[received.length - 1]).toEqual(text('timed'));
  batch.push(text('discarded')); batch.dispose(); await vi.advanceTimersByTimeAsync(50);
  expect(received).toHaveLength(4);
});

it('bounds an accumulated chunk while retaining the entire text', () => {
  vi.useFakeTimers();
  const received: AcpSessionEvent[] = [];
  const batch = batchAcpEvents(event => received.push(event));
  batch.push(text('a'.repeat(40_000))); batch.push(text('b'.repeat(40_000)));
  batch.push({ sessionId: 'session', kind: 'stop', payload: {} });
  expect(received).toEqual([text('a'.repeat(40_000)), text('b'.repeat(40_000)), { sessionId: 'session', kind: 'stop', payload: {} }]);
});
