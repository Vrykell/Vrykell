/**
 * useUsageStats — the usage page's read model.
 *
 * Keeps the range and the provider/model filters in component state and derives everything the
 * page shows from the persisted records: totals, the trend series, the request log (newest
 * first), and the two aggregate tables. Views read this hook instead of the store
 * (architecture rule).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  modelBreakdown,
  providerBreakdown,
  recordsInRange,
  summarize,
  tokensSeries,
  DEFAULT_USAGE_SOURCE,
  type AcpUsageRecord,
  type UsageRange,
} from '@features/agent/model/usageStats';
import { useUsageStore } from '@features/agent/stores/usage';
import { useAiConfigStore } from '../stores/aiConfig';
import { useUsageSources } from '../stores/usageSources';

/** Filter value meaning "everything". */
export const ALL_FILTER = '';

export function useUsageStats() {
  const records = useUsageStore((state) => state.records);
  const acp = useUsageStore((state) => state.acp);
  const configured = useUsageSources(state => state.configured);
  const sourcesError = useUsageSources(state => state.error);
  const models = useAiConfigStore(state => state.models);
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
  useEffect(() => {
    void useUsageSources.getState().refresh();
    const storage = (event: StorageEvent) => {
      if (event.key === 'vrykell-usage' || event.key === null) void useUsageStore.persist.rehydrate();
    };
    const focus = () => { void useUsageSources.getState().refresh(); };
    window.addEventListener('storage', storage);
    window.addEventListener('focus', focus);
    return () => { window.removeEventListener('storage', storage); window.removeEventListener('focus', focus); };
  }, []);

  // Configured sources remain selectable even before their first report or outside the range.
  const sourceOptions = useMemo(
    () => [DEFAULT_USAGE_SOURCE, ...[...new Set([...configured, ...records.map(record => record.source), ...Object.keys(acp)])]
      .filter(name => name !== DEFAULT_USAGE_SOURCE).sort((first, second) => first.localeCompare(second))],
    [configured, records, acp],
  );
  const providerOptions = useMemo(
    () => [...new Set([...models.map(profile => profile.provider), ...records.map(record => record.provider)])].sort((first, second) => first.localeCompare(second)),
    [models, records],
  );
  const modelOptions = useMemo(
    () => [...new Set([...models.map(profile => profile.model).filter(Boolean), ...records.map(record => record.model)])].sort((first, second) => first.localeCompare(second)),
    [models, records],
  );
  // Removed configurations without retained reports fall back to the full source list.
  useEffect(() => {
    if (source && !sourceOptions.includes(source)) setSource(ALL_FILTER);
  }, [source, sourceOptions]);
  useEffect(() => {
    if (provider && !providerOptions.includes(provider)) setProvider(ALL_FILTER);
  }, [provider, providerOptions]);
  useEffect(() => {
    if (model && !modelOptions.includes(model)) setModel(ALL_FILTER);
  }, [model, modelOptions]);
  const visibleProfiles = useMemo(() => source && source !== DEFAULT_USAGE_SOURCE ? []
    : models.filter(profile => profile.model && (!provider || profile.provider === provider) && (!model || profile.model === model)), [models, source, provider, model]);
  const providerRows = useMemo(() => providerBreakdown(filtered, visibleProfiles.map(profile => profile.provider)), [filtered, visibleProfiles]);
  const modelRows = useMemo(() => modelBreakdown(filtered, visibleProfiles), [filtered, visibleProfiles]);
  /** Request log: newest first. */
  const logRows = useMemo(() => [...filtered].reverse(), [filtered]);
  /** ACP servers, most recently active first; the source filter narrows them like the records. */
  const acpRows = useMemo(
    () => [...new Set([...configured, ...Object.keys(acp)])].filter(name => !source || name === source)
      .map((name): AcpUsageRecord => acp[name] ?? { source: name, at: 0, turns: 0, toolCalls: 0, contextUsed: 0, contextSize: 0, cost: null, currency: '' })
      .sort((first, second) => second.at - first.at || first.source.localeCompare(second.source)),
    [configured, acp, source],
  );
  const series = useMemo(() => tokensSeries(filtered, range, Date.now()), [filtered, range, revision]);
  /** Whether any ACP server has reported at all — the clear button clears those too. */
  const hasAcp = useMemo(() => Object.keys(acp).length > 0, [acp]);
  const latestAt = useMemo(
    () => records.reduce((latest, record) => (record.at > latest ? record.at : latest), 0),
    [records],
  );
  const clear = useCallback(() => useUsageStore.getState().clear(), []);
  /** Re-read saved usage and configured sources before deriving a fresh view. */
  const refresh = useCallback(async () => {
    await Promise.all([useUsageStore.persist.rehydrate(), useUsageSources.getState().refresh()]);
    setRevision((value) => value + 1);
    setRefreshedAt(Date.now());
  }, []);

  return {
    records, range, setRange, source, setSource, provider, setProvider, model, setModel,
    sourceOptions, providerOptions, modelOptions, totals, providerRows, modelRows, logRows, series, latestAt,
    acpRows, hasAcp, sourcesError,
    clear, refresh, refreshedAt,
  };
}

export type UsageStats = ReturnType<typeof useUsageStats>;
