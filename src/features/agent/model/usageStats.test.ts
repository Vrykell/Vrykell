import { describe, expect, it } from 'vitest';
import {
  costSeries,
  formatCompact,
  formatTokens,
  MAX_COST_BUCKETS,
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
    costUsd: null,
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
  it('adds tokens, steps, tool calls and known costs', () => {
    const totals = summarize([
      record({ inputTokens: 100, outputTokens: 20, cachedInputTokens: 80, reasoningTokens: 5, steps: 2, toolCalls: 1, costUsd: 0.01 }),
      record({ inputTokens: 50, outputTokens: 10, steps: 1, toolCalls: 3, costUsd: null }),
    ]);
    expect(totals).toEqual({
      turns: 2,
      inputTokens: 150,
      outputTokens: 30,
      cachedInputTokens: 80,
      reasoningTokens: 5,
      steps: 3,
      toolCalls: 4,
      costUsd: 0.01,
      unknownCostTurns: 1,
    });
    expect(totalTokens(totals)).toBe(180);
  });

  it('reports zeros for an empty window', () => {
    expect(summarize([])).toEqual({
      turns: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reasoningTokens: 0, steps: 0,
      toolCalls: 0, costUsd: 0, unknownCostTurns: 0,
    });
  });
});

describe('modelBreakdown', () => {
  it('groups per provider and model, heaviest first', () => {
    const rows = modelBreakdown([
      record({ provider: 'anthropic', model: 'claude-sonnet-4', inputTokens: 100, outputTokens: 10, cachedInputTokens: 60, costUsd: 0.01 }),
      record({ provider: 'anthropic', model: 'claude-sonnet-4', inputTokens: 50, outputTokens: 5, costUsd: 0.02 }),
      record({ provider: 'openai-compatible', model: 'gpt-4o-mini', inputTokens: 900, outputTokens: 100, costUsd: null }),
    ]);
    expect(rows.map((row) => row.key)).toEqual(['openai-compatible:gpt-4o-mini', 'anthropic:claude-sonnet-4']);
    expect(rows[0]).toMatchObject({ turns: 1, costUsd: 0, unknownCostTurns: 1 });
    expect(rows[1]).toMatchObject({
      turns: 2,
      inputTokens: 150,
      outputTokens: 15,
      totalTokens: 165,
      cachedInputTokens: 60,
      costUsd: expect.closeTo(0.03, 5),
      unknownCostTurns: 0,
    });
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

describe('formatCompact', () => {
  it('shortens large counts for the table columns', () => {
    expect(formatCompact(0)).toBe('0');
    expect(formatCompact(999)).toBe('999');
    expect(formatCompact(1200)).toBe('1.2k');
    expect(formatCompact(23456)).toBe('23k');
    expect(formatCompact(2_400_000)).toBe('2.4M');
  });
});

describe('costSeries', () => {
  const now = new Date(2026, 9, 14, 15, 30, 0).getTime();

  it('buckets today by hour and drops the empty lead', () => {
    const { buckets, unit } = costSeries(
      [record({ at: now - 60_000, costUsd: 0.02, inputTokens: 10, outputTokens: 5 })],
      'today',
      now,
    );
    expect(unit).toBe('hour');
    expect(buckets).toHaveLength(1);
    expect(buckets[0]).toMatchObject({ costUsd: 0.02, turns: 1, tokens: 15 });
    expect(buckets[0]!.label).toBe('15:00');
  });

  it('buckets wider ranges by day and keeps unpriced turns as tokens only', () => {
    const { buckets, unit } = costSeries(
      [
        record({ at: now - 2 * DAY, costUsd: 0.5, inputTokens: 100, outputTokens: 0 }),
        record({ at: now - 2 * DAY, costUsd: null, inputTokens: 40, outputTokens: 10 }),
      ],
      '7d',
      now,
    );
    expect(unit).toBe('day');
    // 数据桶 + 之后到今天的空桶（图会展示到当前时刻）
    expect(buckets).toHaveLength(3);
    expect(buckets[0]).toMatchObject({ costUsd: 0.5, turns: 2, tokens: 150 });
    expect(buckets[0]!.label).toBe('10/12');
    expect(buckets[1]).toMatchObject({ costUsd: 0, turns: 0 });
  });

  it('keeps at most the last 60 buckets', () => {
    const { buckets } = costSeries(
      [record({ at: now - 200 * DAY, costUsd: 1 })],
      'all',
      now,
    );
    expect(buckets.length).toBeLessThanOrEqual(MAX_COST_BUCKETS);
    // 200 天前的记录落在窗口外，不显示为柱子
    expect(buckets.every((bucket) => bucket.costUsd === 0)).toBe(true);
  });
});
