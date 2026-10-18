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
  const acp = useUsageStore((state) => state.acp);
  const [range, setRange] = useState<UsageRange>('today');
  const [source, setSource] = useState<string>(ALL_FILTER);
  const [provider, setProvider] = useState<string>(ALL_FILTER);
  const [model, setModel] = useState<string>(ALL_FILTER);
  /** Bumped by a manual refresh so the derived view recomputes with a fresh clock. */
  const [revision, setRevision] = useState(0);
  const [refreshedAt, setRefreshedAt] = useState(0);

  // Recomputed when records, the range, a filter or a manual refresh changes, which is exactly
  // when the numbers should move. The clock is read at that moment, not on every render.
  const inRange = useMemo(() => recordsInRange(records, range, Date.now()), [records, range, revision]);
  const filtered = useMemo(
    () => inRange.filter((record) =>
      (!source || record.source === source) && (!provider || record.provider === provider) && (!model || record.model === model)),
    [inRange, source, provider, model],
  );
  const totals = useMemo(() => summarize(filtered), [filtered]);
  // Options come from the range, so a filter never offers a choice with no rows behind it.
  const sourceOptions = useMemo(
    () => [...new Set(inRange.map((record) => record.source))].sort((a, b) => a.localeCompare(b)),
    [inRange],
  );
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
  /** ACP servers, most recently active first; the protocol reports context and cost, not tokens. */
  const acpRows = useMemo(() => Object.values(acp).sort((a, b) => b.at - a.at), [acp]);
  const series = useMemo(() => tokensSeries(filtered, range, Date.now()), [filtered, range, revision]);
  const latestAt = useMemo(
    () => records.reduce((latest, record) => (record.at > latest ? record.at : latest), 0),
    [records],
  );
  const clear = useCallback(() => useUsageStore.getState().clear(), []);
  /** Re-read what the store persisted and re-derive the view; cheap and side-effect free. */
  const refresh = useCallback(() => {
    void useUsageStore.persist.rehydrate();
    setRevision((value) => value + 1);
    setRefreshedAt(Date.now());
  }, []);

  return {
    records, range, setRange, source, setSource, provider, setProvider, model, setModel,
    sourceOptions, providerOptions, modelOptions, totals, providerRows, modelRows, logRows, series, latestAt,
    acpRows,
    clear, refresh, refreshedAt,
  };
}

export type UsageStats = ReturnType<typeof useUsageStats>;
