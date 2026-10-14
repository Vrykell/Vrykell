/**
 * useUsageStats — the usage panel's read model.
 *
 * Keeps the range selection in component state and derives what the panel shows from
 * the persisted records. Views read this hook instead of the store (architecture rule).
 */
import { useCallback, useMemo, useState } from 'react';
import {
  modelBreakdown,
  recordsInRange,
  summarize,
  tokensSeries,
  type UsageRange,
} from '@features/agent/model/usageStats';
import { useUsageStore } from '@features/agent/stores/usage';

/** Newest turns listed under "recent"; older ones stay in the aggregates. */
export const RECENT_USAGE_ROWS = 15;

export function useUsageStats() {
  const records = useUsageStore((state) => state.records);
  const [range, setRange] = useState<UsageRange>('today');

  // Recomputed when records or the range change, which is exactly when a finished
  // turn should appear. The clock is only read at that moment, not on every render.
  const inRange = useMemo(() => recordsInRange(records, range, Date.now()), [records, range]);
  const totals = useMemo(() => summarize(inRange), [inRange]);
  const models = useMemo(() => modelBreakdown(inRange), [inRange]);
  const recent = useMemo(() => [...inRange].slice(-RECENT_USAGE_ROWS).reverse(), [inRange]);
  const series = useMemo(() => tokensSeries(records, range, Date.now()), [records, range]);
  const clear = useCallback(() => useUsageStore.getState().clear(), []);

  return { records, range, setRange, totals, models, recent, series, clear };
}

export type UsageStats = ReturnType<typeof useUsageStats>;
