/**
 * agentErrors — AI SDK 错误拆解测试。
 */
import { describe, it, expect } from 'vitest';
import { describeError } from '@features/agent/agentErrors';

describe('describeError', () => {
  it('普通 Error 取其 message', () => {
    expect(describeError(new Error('boom'))).toContain('boom');
  });

  it('展开 APICallError：状态码 + 响应体 + cause 链', () => {
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

  it('去重：cause 与上层同消息只出现一次', () => {
    const err: Error & { cause?: unknown } = Object.assign(new Error('same'), {
      cause: new Error('same'),
    });
    const s = describeError(err);
    expect(s.split('same').length - 1).toBe(1);
  });

  it('非 Error 值转字符串；未知返回兜底', () => {
    expect(describeError('plain')).toContain('plain');
    expect(describeError(undefined)).toBe('未知错误');
  });
});
