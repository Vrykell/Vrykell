/**
 * usageStats — pure aggregation behind the usage panel.
 *
 * Records are written by the streaming turn (`agentStream`) from the token counts the
 * provider reports; nothing here estimates tokens. The panel counts tokens and requests
 * only — no money: prices vary per plan and would make the numbers look authoritative
 * when they are not. Auxiliary calls (session titles, command completion, context
 * summaries) are not recorded yet, and the panel says so instead of pretending the totals
 * are complete.
 */

export type UsageRange = 'today' | '7d' | '30d' | 'all';

export interface UsageRecord {
  id: string;
  /** Epoch milliseconds when the turn finished. */
  at: number;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Input tokens served from the provider's prompt cache. */
  cachedInputTokens: number;
  reasoningTokens: number;
  /** Completed model steps of the turn. */
  steps: number;
  /** Tool calls issued across those steps. */
  toolCalls: number;
}

export interface UsageTotals {
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
  steps: number;
  toolCalls: number;
}

export interface ModelUsageRow {
  key: string;
  provider: string;
  model: string;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  totalTokens: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Lower bound (inclusive) of a range; 0 means "no bound". */
export function rangeStart(range: UsageRange, now: number): number {
  switch (range) {
    case 'today': {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      return start.getTime();
    }
    case '7d':
      return now - 7 * DAY_MS;
    case '30d':
      return now - 30 * DAY_MS;
    default:
      return 0;
  }
}

export function recordsInRange(records: UsageRecord[], range: UsageRange, now: number): UsageRecord[] {
  const from = rangeStart(range, now);
  return from === 0 ? records : records.filter((record) => record.at >= from);
}

export function summarize(records: UsageRecord[]): UsageTotals {
  const totals: UsageTotals = {
    turns: records.length,
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    reasoningTokens: 0,
    steps: 0,
    toolCalls: 0,
  };
  for (const record of records) {
    totals.inputTokens += record.inputTokens;
    totals.outputTokens += record.outputTokens;
    totals.cachedInputTokens += record.cachedInputTokens;
    totals.reasoningTokens += record.reasoningTokens;
    totals.steps += record.steps;
    totals.toolCalls += record.toolCalls;
  }
  return totals;
}

/** Per-model split, heaviest first; ties keep a stable name order. */
export function modelBreakdown(records: UsageRecord[]): ModelUsageRow[] {
  const rows = new Map<string, ModelUsageRow>();
  for (const record of records) {
    const key = `${record.provider}:${record.model}`;
    const row = rows.get(key) ?? {
      key,
      provider: record.provider,
      model: record.model,
      turns: 0,
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      totalTokens: 0,
    };
    row.turns += 1;
    row.inputTokens += record.inputTokens;
    row.outputTokens += record.outputTokens;
    row.cachedInputTokens += record.cachedInputTokens;
    row.totalTokens = row.inputTokens + row.outputTokens;
    rows.set(key, row);
  }
  return [...rows.values()].sort(
    (a, b) => b.totalTokens - a.totalTokens || a.model.localeCompare(b.model),
  );
}

export interface UsageBucket {
  /** Bucket start, epoch milliseconds. */
  start: number;
  label: string;
  tokens: number;
  turns: number;
}

/** Buckets kept at most; a longer range is charted by its most recent window. */
export const MAX_USAGE_BUCKETS = 60;

/**
 * Tokens per hour (today) or per day (wider ranges), ready for the bar chart.
 *
 * The window is capped at `MAX_USAGE_BUCKETS` so a long history still renders: the chart shows
 * the most recent buckets of the selected range.
 */
export function tokensSeries(
  records: UsageRecord[],
  range: UsageRange,
  now: number,
): { buckets: UsageBucket[]; unit: 'hour' | 'day' } {
  const hourly = range === 'today';
  const inRange = recordsInRange(records, range, now);
  const size = hourly ? 60 * 60 * 1000 : DAY_MS;
  const anchorStart = Math.floor(now / size) * size;
  const firstBucket = anchorStart - (MAX_USAGE_BUCKETS - 1) * size;
  const buckets: UsageBucket[] = [];
  for (let i = 0; i < MAX_USAGE_BUCKETS; i += 1) {
    const start = firstBucket + i * size;
    const date = new Date(start);
    buckets.push({
      start,
      label: hourly
        ? `${String(date.getHours()).padStart(2, '0')}:00`
        : `${date.getMonth() + 1}/${date.getDate()}`,
      tokens: 0,
      turns: 0,
    });
  }
  for (const record of inRange) {
    const index = Math.floor((record.at - firstBucket) / size);
    const bucket = buckets[index];
    if (!bucket) continue;
    bucket.tokens += record.inputTokens + record.outputTokens;
    bucket.turns += 1;
  }
  // 没有用量的前导空桶对读图没帮助：从第一个有数据（或最后一个）的桶开始
  const firstWithData = buckets.findIndex((bucket) => bucket.turns > 0);
  const trimmed = firstWithData > 0 ? buckets.slice(firstWithData) : buckets.slice(-1);
  return { buckets: trimmed, unit: hourly ? 'hour' : 'day' };
}

/** Thousands separators keep long token counts readable at panel width. */
export function formatTokens(value: number): string {
  return value.toLocaleString('en-US');
}

/** Compact token counts for narrow columns: 1234 → "1.2k", 1234567 → "1.2M". */
export function formatCompact(value: number): string {
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`;
  return `${(value / 1_000_000).toFixed(1)}M`;
}

/** The token total a record (or a summary) represents. */
export function totalTokens(counts: { inputTokens: number; outputTokens: number }): number {
  return counts.inputTokens + counts.outputTokens;
}
