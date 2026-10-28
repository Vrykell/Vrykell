import { describe, expect, it } from 'vitest';
import {
  cacheHitRate,
  DEFAULT_USAGE_SOURCE,
  formatCompact,
  formatLogFullTime,
  formatLogTime,
  formatTokens,
  freshInputTokens,
  MAX_USAGE_BUCKETS,
  modelBreakdown,
  paginate,
  providerBreakdown,
  rangeStart,
  realTokens,
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
    source: DEFAULT_USAGE_SOURCE,
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
  it('includes unused configured models without duplicate or invented usage', () => {
    const configured = [{ provider: 'anthropic', model: 'claude-sonnet-4' }, { provider: 'local', model: 'unused' }];
    const rows = modelBreakdown([record()], [...configured, ...configured]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ model: 'claude-sonnet-4', turns: 1, totalTokens: 120 });
    expect(rows[1]).toMatchObject({ model: 'unused', turns: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 });
  });

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
  it('shortens large counts with the Chinese units the copy uses', () => {
    expect(formatCompact(0)).toBe('0');
    expect(formatCompact(999)).toBe('999');
    expect(formatCompact(1200)).toBe('1200');
    expect(formatCompact(12345)).toBe('1.2万');
    expect(formatCompact(20000)).toBe('2万');
    expect(formatCompact(14_000_000)).toBe('1400万');
    expect(formatCompact(671_000_000)).toBe('6.7亿');
  });
});

describe('derived metrics', () => {
  it('reads fresh input, cache hit rate and billed tokens from the reported counts', () => {
    const counts = { inputTokens: 1200, outputTokens: 300, cachedInputTokens: 800 };
    expect(freshInputTokens(counts)).toBe(400);
    expect(cacheHitRate(counts)).toBeCloseTo(0.6667, 3);
    expect(realTokens(counts)).toBe(1500);
  });

  it('stays at zero when the provider reports nothing', () => {
    expect(freshInputTokens({ inputTokens: 0, cachedInputTokens: 10 })).toBe(0);
    expect(cacheHitRate({ inputTokens: 0, cachedInputTokens: 0 })).toBe(0);
    expect(realTokens({ inputTokens: 0, outputTokens: 0 })).toBe(0);
  });
});

describe('providerBreakdown', () => {
  it('includes unused configured providers without duplicate or invented usage', () => {
    const rows = providerBreakdown([record()], ['anthropic', 'local', 'local']);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ provider: 'anthropic', turns: 1, totalTokens: 120 });
    expect(rows[1]).toMatchObject({ provider: 'local', turns: 0, totalTokens: 0, steps: 0, toolCalls: 0 });
  });

  it('groups per provider, heaviest first, with steps and tool calls', () => {
    const rows = providerBreakdown([
      record({ provider: 'anthropic', inputTokens: 100, outputTokens: 10, cachedInputTokens: 40, steps: 2, toolCalls: 1 }),
      record({ provider: 'openai-compatible', inputTokens: 900, outputTokens: 100, steps: 3, toolCalls: 4 }),
      record({ provider: 'anthropic', inputTokens: 50, outputTokens: 5, steps: 1 }),
    ]);
    expect(rows.map((row) => row.provider)).toEqual(['openai-compatible', 'anthropic']);
    expect(rows[1]).toMatchObject({
      turns: 2, inputTokens: 150, outputTokens: 15, totalTokens: 165, cachedInputTokens: 40, steps: 3, toolCalls: 1,
    });
  });
});

describe('paginate', () => {
  const rows = Array.from({ length: 45 }, (_, index) => index);

  it('slices one page and clamps an out-of-range page', () => {
    expect(paginate(rows, 0, 20)).toMatchObject({ page: 0, totalPages: 3, total: 45 });
    expect(paginate(rows, 0, 20).rows[0]).toBe(0);
    expect(paginate(rows, 2, 20).rows).toEqual([40, 41, 42, 43, 44]);
    expect(paginate(rows, 9, 20).page).toBe(2);
    expect(paginate(rows, -3, 20).page).toBe(0);
  });

  it('keeps one empty page for an empty table', () => {
    expect(paginate([], 0, 20)).toMatchObject({ page: 0, totalPages: 1, total: 0, rows: [] });
  });
});

describe('log time formatting', () => {
  const now = new Date(2026, 9, 14, 16, 0, 5).getTime();

  it('shows the clock for today and the date for older rows', () => {
    expect(formatLogTime(new Date(2026, 9, 14, 15, 38, 55).getTime(), now)).toBe('15:38:55');
    expect(formatLogTime(new Date(2026, 8, 30, 14, 21, 5).getTime(), now)).toBe('09-30 14:21');
  });

  it('keeps a full stamp for the hover title', () => {
    expect(formatLogFullTime(new Date(2026, 8, 30, 14, 21, 5).getTime())).toBe('2026-09-30 14:21:05');
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
    // The bucket with data plus the empty buckets that follow it through today (the chart draws up to the current moment)
    expect(buckets).toHaveLength(3);
    expect(buckets[0]).toMatchObject({ tokens: 150, turns: 2 });
    expect(buckets[0]!.label).toBe('10/12');
    expect(buckets[1]).toMatchObject({ tokens: 0, turns: 0 });
  });

  it('keeps at most the last 60 buckets', () => {
    const { buckets } = tokensSeries([record({ at: now - 200 * DAY })], 'all', now);
    expect(buckets.length).toBeLessThanOrEqual(MAX_USAGE_BUCKETS);
    // A record from 200 days ago falls outside the window and draws no bar
    expect(buckets.every((bucket) => bucket.tokens === 0)).toBe(true);
  });
});
