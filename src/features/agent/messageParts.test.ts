/**
 * messageParts pure-function tests: serialization roundtrip, dirty-data fallback, history summary format.
 */
import { describe, it, expect } from 'vitest';
import {
  serializeParts,
  deserializeParts,
  partsToHistoryText,
  type MessagePart,
} from '@features/agent/model/messageParts';
import { t } from '@i18n';

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
  it('roundtrip preserves structure', () => {
    const raw = serializeParts(sampleParts);
    expect(deserializeParts(raw)).toEqual(sampleParts);
  });

  it('undefined / empty array serializes to an empty string', () => {
    expect(serializeParts(undefined)).toBe('');
    expect(serializeParts([])).toBe('');
  });

  it('empty string / dirty JSON / non-array / empty array -> undefined', () => {
    expect(deserializeParts('')).toBeUndefined();
    expect(deserializeParts('{oops')).toBeUndefined();
    expect(deserializeParts('{"kind":"text"}')).toBeUndefined();
    expect(deserializeParts('[]')).toBeUndefined();
  });
});

describe('partsToHistoryText', () => {
  it('tool parts collapse into a one-line summary and text is ignored', () => {
    const text = partsToHistoryText(sampleParts);
    expect(text).toBe(`\n[${t('Execute command')}: ls -la → ${t('Succeeded')}]`);
  });

  it('path/query target and status copy', () => {
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
      `\n[${t('Read file')}: src/main.ts → ${t('Succeeded')}]\n[${t('Search')}: foo → ${t('Failed')}]\n[mystery_tool → ${t('Denied')}]`,
    );
  });

  it('no parts / text-only parts -> empty string', () => {
    expect(partsToHistoryText(undefined)).toBe('');
    expect(partsToHistoryText([{ kind: 'text', text: 'x' }])).toBe('');
  });
});
