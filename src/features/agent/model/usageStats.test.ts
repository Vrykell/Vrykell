import { describe, expect, it } from 'vitest';
import {
  formatCompact,
  formatTokens,
  MAX_USAGE_BUCKETS,
  modelBreakdown,
  rangeStart,
  recordsInRange,
  summarize,
  tokensSeries,
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
      record({ provider: 'anthropic', model: 'claude-sonnet-4', inputTokens: 100, outputTokens: 10, cachedInputTokens: 60 }),
      record({ provider: 'anthropic', model: 'claude-sonnet-4', inputTokens: 50, outputTokens: 5 }),
      record({ provider: 'openai-compatible', model: 'gpt-4o-mini', inputTokens: 900, outputTokens: 100 }),
    ]);
    expect(rows.map((row) => row.key)).toEqual(['openai-compatible:gpt-4o-mini', 'anthropic:claude-sonnet-4']);
    expect(rows[1]).toMatchObject({
      turns: 2,
      inputTokens: 150,
      outputTokens: 15,
      totalTokens: 165,
      cachedInputTokens: 60,
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

describe('tokensSeries', () => {
  const now = new Date(2026, 9, 14, 15, 30, 0).getTime();

  it('buckets today by hour and drops the empty lead', () => {
    const { buckets, unit } = tokensSeries(
      [record({ at: now - 60_000, inputTokens: 10, outputTokens: 5 })],
      'today',
      now,
    );
    expect(unit).toBe('hour');
    expect(buckets).toHaveLength(1);
    expect(buckets[0]).toMatchObject({ tokens: 15, turns: 1 });
    expect(buckets[0]!.label).toBe('15:00');
  });

  it('buckets wider ranges by day and sums the tokens of each day', () => {
    const { buckets, unit } = tokensSeries(
      [
        record({ at: now - 2 * DAY, inputTokens: 100, outputTokens: 0 }),
        record({ at: now - 2 * DAY, inputTokens: 40, outputTokens: 10 }),
      ],
      '7d',
      now,
    );
    expect(unit).toBe('day');
    // 数据桶 + 之后到今天的空桶（图会展示到当前时刻）
    expect(buckets).toHaveLength(3);
    expect(buckets[0]).toMatchObject({ tokens: 150, turns: 2 });
    expect(buckets[0]!.label).toBe('10/12');
    expect(buckets[1]).toMatchObject({ tokens: 0, turns: 0 });
  });

  it('keeps at most the last 60 buckets', () => {
    const { buckets } = tokensSeries([record({ at: now - 200 * DAY })], 'all', now);
    expect(buckets.length).toBeLessThanOrEqual(MAX_USAGE_BUCKETS);
    // 200 天前的记录落在窗口外，不显示为柱子
    expect(buckets.every((bucket) => bucket.tokens === 0)).toBe(true);
  });
});
