/**
 * UsageView — the usage statistics workspace page.
 *
 * Follows the reference dashboard's shape: page header, a filter row (provider / model / range),
 * the metric cards, the trend chart, then the request log / providers / models tables. Counts are
 * tokens and requests only, never money, and every number comes from the provider's own usage
 * report (see `agentStream`); auxiliary calls are not counted yet.
 */
import { useState } from 'react';
import { t, type I18nKey } from '@i18n';
import { useToastStore } from '@ui/Toast';
import { IconButton } from '@ui/IconButton';
import Select from '@ui/Select';
import { DataUsage, RefreshCw, Trash2, iconSizes } from '@ui/icons';
import { formatLogTime, type UsageRange } from '@features/agent/model/usageStats';
import { ALL_FILTER, useUsageStats } from '@features/agent/hooks/useUsageStats';
import MetricsRow from './usage/MetricsRow';
import AcpUsageSection from './usage/AcpUsageSection';
import SourceFilter from './usage/SourceFilter';
import TrendChart from './usage/TrendChart';
import RequestLogTable from './usage/RequestLogTable';
import { ModelStatsTable, ProviderStatsTable } from './usage/StatsTables';

const RANGE_OPTIONS: Array<{ value: UsageRange; label: I18nKey }> = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'all', label: 'All time' },
];

type UsageTab = 'logs' | 'providers' | 'models';

const TAB_LABELS: Array<{ id: UsageTab; label: I18nKey }> = [
  { id: 'logs', label: 'Request log' },
  { id: 'providers', label: 'Providers' },
  { id: 'models', label: 'Models' },
];

function FilterSelect({ label, tip, value, options, onChange, testId, width }: {
  label: string;
  /** Full current value for the hover tip, since the narrow trigger truncates long names. */
  tip?: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (next: string) => void;
  testId: string;
  width: number;
}) {
  return (
    <Select aria-label={label} data-testid={testId} value={value} options={options} onChange={onChange}
      data-tip={tip} style={{ width, maxWidth: 168 }} />
  );
}

export default function UsageView() {
  const stats = useUsageStats();
  const [tab, setTab] = useState<UsageTab>('logs');
  const [spinning, setSpinning] = useState(false);
  const rangeLabel = t(RANGE_OPTIONS.find((option) => option.value === stats.range)!.label);

  const clearUsage = () => {
    stats.clear();
    useToastStore.getState().addToast(t('Usage data cleared'), 'success');
  };

  /** Refresh re-reads what the store persisted and re-derives the view, with a short spin cue. */
  const refreshUsage = () => {
    stats.refresh();
    setSpinning(true);
    window.setTimeout(() => setSpinning(false), 320);
  };

  return (
    <div data-testid="usage-page" className="usage-page scroll-region" style={{
      flex: 1, minHeight: 0, overflowY: 'auto', padding: '18px 22px 24px',
      background: 'var(--canvas)', userSelect: 'none', display: 'flex', flexDirection: 'column', gap: 14,
    }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <DataUsage size={iconSizes.row} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
        <strong data-tip={t('Usage statistics')}
          data-tip-description={t('Requests and token usage the provider reported on this machine.')}
          style={{ color: 'var(--text-primary)', fontSize: 'var(--fs-subtitle)', fontWeight: 'var(--fw-semibold)' }}>
          {t('Usage statistics')}
        </strong>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 'var(--fs-caption)' }}>
          <span data-testid="usage-record-count">{t('{{count}} records', { count: stats.records.length })}</span>
          {stats.latestAt > 0 && <span>· {t('Latest {{time}}', { time: formatLogTime(stats.latestAt) })}</span>}
          {stats.refreshedAt > 0 && (
            <span data-testid="usage-refreshed-at">· {t('Refreshed at {{time}}', { time: formatLogTime(stats.refreshedAt) })}</span>
          )}
          <IconButton compact data-testid="usage-refresh" aria-label={t('Refresh usage')} data-tip={t('Refresh usage')}
            onClick={refreshUsage}>
            <RefreshCw size={iconSizes.compact}
              style={{ transform: spinning ? 'rotate(360deg)' : 'none', transition: 'transform 0.3s var(--ease)' }} />
          </IconButton>
          <IconButton compact tone="danger" data-testid="usage-clear" disabled={stats.records.length === 0}
            aria-label={t('Clear usage data')} data-tip={t('Clear usage data')} onClick={clearUsage}>
            <Trash2 size={iconSizes.compact} />
          </IconButton>
        </span>
      </header>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <SourceFilter value={stats.source} options={stats.sourceOptions} onChange={stats.setSource} />
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <FilterSelect label={t('Provider')} testId="usage-filter-provider" width={132}
            value={stats.provider} tip={stats.provider || t('All')}
            options={[{ value: ALL_FILTER, label: t('All') }, ...stats.providerOptions.map((option) => ({ value: option, label: option }))]}
            onChange={stats.setProvider} />
          <FilterSelect label={t('Model')} testId="usage-filter-model" width={140}
            value={stats.model} tip={stats.model || t('All')}
            options={[{ value: ALL_FILTER, label: t('All') }, ...stats.modelOptions.map((option) => ({ value: option, label: option }))]}
            onChange={stats.setModel} />
          <FilterSelect label={t('Usage range')} testId="usage-range" width={104} value={stats.range}
            options={RANGE_OPTIONS.map((option) => ({ value: option.value, label: t(option.label) }))}
            onChange={(next) => stats.setRange(next as UsageRange)} />
        </span>
      </div>

      <MetricsRow totals={stats.totals} />

      <TrendChart buckets={stats.series.buckets} unit={stats.series.unit} rangeLabel={rangeLabel} />

      <AcpUsageSection rows={stats.acpRows} />

      <section className="usage-card" style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div role="tablist" aria-label={t('Usage details')} style={{ display: 'flex', gap: 4, paddingBottom: 8 }}>
          {TAB_LABELS.map(({ id, label }) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} data-subtle
              data-testid={`usage-tab-${id}`} onClick={() => setTab(id)}
              style={{
                padding: '4px 10px', border: 0, borderRadius: 'var(--radius-inner)',
                background: tab === id ? 'var(--hover)' : 'transparent',
                color: tab === id ? 'var(--text-primary)' : 'var(--text-secondary)',
                font: `${tab === id ? 'var(--fw-medium)' : 'var(--fw-regular)'} var(--fs-label) var(--font-ui)`,
                cursor: 'pointer',
                transition: 'background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease)',
              }}>
              {t(label)}
            </button>
          ))}
        </div>
        {tab === 'logs' && <RequestLogTable rows={stats.logRows} />}
        {tab === 'providers' && <ProviderStatsTable rows={stats.providerRows} />}
        {tab === 'models' && <ModelStatsTable rows={stats.modelRows} />}
      </section>
    </div>
  );
}
