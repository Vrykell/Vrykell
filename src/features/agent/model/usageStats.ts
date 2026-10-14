/**
 * usageStats — pure aggregation behind the usage panel.
 *
 * Records are written by the streaming turn (`agentStream`) from the token counts the
 * provider reports; nothing here estimates tokens. Auxiliary calls (session titles,
 * command completion, context summaries) are not recorded yet, so the panel states
 * that limitation instead of pretending the numbers are complete.
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
      totalTokens: 0,
    };
    row.turns += 1;
    row.inputTokens += record.inputTokens;
    row.outputTokens += record.outputTokens;
    row.totalTokens = row.inputTokens + row.outputTokens;
    rows.set(key, row);
  }
  return [...rows.values()].sort(
    (a, b) => b.totalTokens - a.totalTokens || a.model.localeCompare(b.model),
  );
}

/** Thousands separators keep long token counts readable at panel width. */
export function formatTokens(value: number): string {
  return value.toLocaleString('en-US');
}

/** The token total a record (or a summary) represents. */
export function totalTokens(counts: { inputTokens: number; outputTokens: number }): number {
  return counts.inputTokens + counts.outputTokens;
}
