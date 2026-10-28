/**
 * agentErrors — AI SDK error decomposition tests.
 */
import { describe, it, expect } from 'vitest';
import { describeError } from '@features/agent/model/agentErrors';

describe('describeError', () => {
  it('uses the message of a plain Error', () => {
    expect(describeError(new Error('boom'))).toContain('boom');
  });

  it('expands APICallError: status code + response body + cause chain', () => {
    const err: Error & { statusCode?: number; responseBody?: string; cause?: unknown } = Object.assign(
      new Error('Failed after 3 attempts'),
      {
        statusCode: 401,
        responseBody: '{"error":{"message":"invalid key"}}',
        cause: Object.assign(new Error('上游错误'), { responseBody: 'bad' }),
      },
    );
    const s = describeError(err);
    expect(s).toContain('401');
    expect(s).toContain('invalid key');
    expect(s).toContain('上游错误');
  });

  it('deduplicates: a cause with the same message appears only once', () => {
    const err: Error & { cause?: unknown } = Object.assign(new Error('same'), {
      cause: new Error('same'),
    });
    const s = describeError(err);
    expect(s.split('same').length - 1).toBe(1);
  });

  it('converts non-Error values to strings; falls back for unknown values', () => {
    expect(describeError('plain')).toContain('plain');
    expect(describeError(undefined)).toBe('未知错误');
  });
});
