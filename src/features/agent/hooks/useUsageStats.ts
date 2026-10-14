/**
 * useUsageStats — the usage page's read model.
 *
 * Keeps the range and the provider/model filters in component state and derives everything the
 * page shows from the persisted records: totals, the trend series, the request log (newest
 * first), and the two aggregate tables. Views read this hook instead of the store
 * (architecture rule).
 */
import { useCallback, useMemo, useState } from 'react';
import {
  modelBreakdown,
  providerBreakdown,
  recordsInRange,
  summarize,
  tokensSeries,
  type UsageRange,
} from '@features/agent/model/usageStats';
import { useUsageStore } from '@features/agent/stores/usage';

/** Filter value meaning "everything". */
export const ALL_FILTER = '';

export function useUsageStats() {
  const records = useUsageStore((state) => state.records);
  const [range, setRange] = useState<UsageRange>('today');
  const [provider, setProvider] = useState<string>(ALL_FILTER);
  const [model, setModel] = useState<string>(ALL_FILTER);

  // Recomputed when records, the range or a filter changes, which is exactly when a finished
  // turn should appear. The clock is only read at that moment, not on every render.
  const inRange = useMemo(() => recordsInRange(records, range, Date.now()), [records, range]);
  const filtered = useMemo(
    () => inRange.filter((record) => (!provider || record.provider === provider) && (!model || record.model === model)),
    [inRange, provider, model],
  );
  const totals = useMemo(() => summarize(filtered), [filtered]);
  // Options come from the range, so a filter never offers a choice with no rows behind it.
  const providerOptions = useMemo(
    () => [...new Set(inRange.map((record) => record.provider))].sort((a, b) => a.localeCompare(b)),
    [inRange],
  );
  const modelOptions = useMemo(
    () => [...new Set(inRange.map((record) => record.model))].sort((a, b) => a.localeCompare(b)),
    [inRange],
  );
  const providerRows = useMemo(() => providerBreakdown(filtered), [filtered]);
  const modelRows = useMemo(() => modelBreakdown(filtered), [filtered]);
  /** Request log: newest first. */
  const logRows = useMemo(() => [...filtered].reverse(), [filtered]);
  const series = useMemo(() => tokensSeries(filtered, range, Date.now()), [filtered, range]);
  const latestAt = useMemo(
    () => records.reduce((latest, record) => (record.at > latest ? record.at : latest), 0),
    [records],
  );
  const clear = useCallback(() => useUsageStore.getState().clear(), []);

  return {
    records, range, setRange, provider, setProvider, model, setModel,
    providerOptions, modelOptions, totals, providerRows, modelRows, logRows, series, latestAt, clear,
  };
}

export type UsageStats = ReturnType<typeof useUsageStats>;
