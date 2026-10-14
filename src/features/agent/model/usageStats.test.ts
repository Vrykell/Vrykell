import { describe, expect, it } from 'vitest';
import {
  formatTokens,
  modelBreakdown,
  rangeStart,
  recordsInRange,
  summarize,
  totalTokens,
  type UsageRecord,
} from './usageStats';

const DAY = 24 * 60 * 60 * 1000;

function record(patch: Partial<UsageRecord> = {}): UsageRecord {
  return {
    id: 'r',
    at: 0,
    provider: 'anthropic',
    model: 'claude-sonnet-4',
    inputTokens: 100,
    outputTokens: 20,
    cachedInputTokens: 0,
    reasoningTokens: 0,
    steps: 1,
    toolCalls: 0,
    ...patch,
  };
}

describe('rangeStart', () => {
  it('starts today at local midnight and counts fixed windows back', () => {
    const now = new Date(2026, 9, 14, 15, 30).getTime();
    expect(rangeStart('today', now)).toBe(new Date(2026, 9, 14, 0, 0, 0, 0).getTime());
    expect(rangeStart('7d', now)).toBe(now - 7 * DAY);
    expect(rangeStart('30d', now)).toBe(now - 30 * DAY);
    expect(rangeStart('all', now)).toBe(0);
  });
});

describe('recordsInRange', () => {
  const now = new Date(2026, 9, 14, 12, 0).getTime();
  const records = [
    record({ id: 'old', at: now - 10 * DAY }),
    record({ id: 'week', at: now - 2 * DAY }),
    record({ id: 'today', at: now - 60_000 }),
  ];

  it('keeps the newest window and preserves order', () => {
    expect(recordsInRange(records, 'today', now).map((r) => r.id)).toEqual(['today']);
    expect(recordsInRange(records, '7d', now).map((r) => r.id)).toEqual(['week', 'today']);
    expect(recordsInRange(records, '30d', now).map((r) => r.id)).toEqual(['old', 'week', 'today']);
    expect(recordsInRange(records, 'all', now)).toHaveLength(3);
  });
});

describe('summarize', () => {
  it('adds tokens, steps and tool calls', () => {
    const totals = summarize([
      record({ inputTokens: 100, outputTokens: 20, cachedInputTokens: 80, reasoningTokens: 5, steps: 2, toolCalls: 1 }),
      record({ inputTokens: 50, outputTokens: 10, steps: 1, toolCalls: 3 }),
    ]);
    expect(totals).toEqual({
      turns: 2,
      inputTokens: 150,
      outputTokens: 30,
      cachedInputTokens: 80,
      reasoningTokens: 5,
      steps: 3,
      toolCalls: 4,
    });
    expect(totalTokens(totals)).toBe(180);
  });

  it('reports zeros for an empty window', () => {
    expect(summarize([])).toEqual({
      turns: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reasoningTokens: 0, steps: 0, toolCalls: 0,
    });
  });
});

describe('modelBreakdown', () => {
  it('groups per provider and model, heaviest first', () => {
    const rows = modelBreakdown([
      record({ provider: 'anthropic', model: 'claude-sonnet-4', inputTokens: 100, outputTokens: 10 }),
      record({ provider: 'anthropic', model: 'claude-sonnet-4', inputTokens: 50, outputTokens: 5 }),
      record({ provider: 'openai-compatible', model: 'gpt-4o-mini', inputTokens: 900, outputTokens: 100 }),
    ]);
    expect(rows.map((row) => row.key)).toEqual(['openai-compatible:gpt-4o-mini', 'anthropic:claude-sonnet-4']);
    expect(rows[1]).toMatchObject({ turns: 2, inputTokens: 150, outputTokens: 15, totalTokens: 165 });
  });

  it('keeps a stable order when totals tie', () => {
    const rows = modelBreakdown([
      record({ model: 'z-model' }),
      record({ model: 'a-model' }),
    ]);
    expect(rows.map((row) => row.model)).toEqual(['a-model', 'z-model']);
  });
});

describe('formatTokens', () => {
  it('groups thousands for narrow columns', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(1500)).toBe('1,500');
    expect(formatTokens(1234567)).toBe('1,234,567');
  });
});
