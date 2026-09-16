/**
 * messageParts 纯函数测试：序列化 roundtrip、脏数据兜底、history 摘要格式。
 */
import { describe, it, expect } from 'vitest';
import {
  serializeParts,
  deserializeParts,
  partsToHistoryText,
  type MessagePart,
} from '@features/agent/model/messageParts';

const sampleParts: MessagePart[] = [
  { kind: 'text', text: '我来看看。' },
  {
    kind: 'tool',
    tool: {
      toolCallId: 'tc1',
      toolName: 'run_command',
      input: { command: 'ls -la' },
      state: 'done',
      output: '{"ok":true,"exitCode":0,"output":"..."}',
      startedAt: 1000,
      endedAt: 2000,
    },
  },
  { kind: 'text', text: '目录里有这些文件。' },
];

describe('serializeParts / deserializeParts', () => {
  it('roundtrip 保持结构', () => {
    const raw = serializeParts(sampleParts);
    expect(deserializeParts(raw)).toEqual(sampleParts);
  });

  it('undefined / 空数组序列化为空串', () => {
    expect(serializeParts(undefined)).toBe('');
    expect(serializeParts([])).toBe('');
  });

  it('空串 / 脏 JSON / 非数组 / 空数组 → undefined', () => {
    expect(deserializeParts('')).toBeUndefined();
    expect(deserializeParts('{oops')).toBeUndefined();
    expect(deserializeParts('{"kind":"text"}')).toBeUndefined();
    expect(deserializeParts('[]')).toBeUndefined();
  });
});

describe('partsToHistoryText', () => {
  it('tool part 折叠为单行摘要，text 忽略', () => {
    const text = partsToHistoryText(sampleParts);
    expect(text).toBe('\n[执行命令: ls -la → 成功]');
  });

  it('path/query 目标与状态文案', () => {
    const parts: MessagePart[] = [
      {
        kind: 'tool',
        tool: {
          toolCallId: 'a',
          toolName: 'read_file',
          input: { path: 'src/main.ts' },
          state: 'done',
          startedAt: 1,
        },
      },
      {
        kind: 'tool',
        tool: {
          toolCallId: 'b',
          toolName: 'search_files',
          input: { query: 'foo' },
          state: 'error',
          startedAt: 2,
        },
      },
      {
        kind: 'tool',
        tool: {
          toolCallId: 'c',
          toolName: 'mystery_tool',
          input: {},
          state: 'denied',
          startedAt: 3,
        },
      },
    ];
    expect(partsToHistoryText(parts)).toBe(
      '\n[读取文件: src/main.ts → 成功]\n[搜索: foo → 失败]\n[mystery_tool → 已拒绝]',
    );
  });

  it('无 parts / 纯文本 parts → 空串', () => {
    expect(partsToHistoryText(undefined)).toBe('');
    expect(partsToHistoryText([{ kind: 'text', text: 'x' }])).toBe('');
  });
});
