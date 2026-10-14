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
import { DataUsage, Info, Trash2, iconSizes } from '@ui/icons';
import { formatLogTime, type UsageRange } from '@features/agent/model/usageStats';
import { ALL_FILTER, useUsageStats } from '@features/agent/hooks/useUsageStats';
import MetricsRow from './usage/MetricsRow';
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

function FilterSelect({ label, value, options, onChange, testId }: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (next: string) => void;
  testId: string;
}) {
  return (
    <Select aria-label={label} data-testid={testId} value={value} options={options} onChange={onChange}
      style={{ minWidth: 136, maxWidth: 220 }} />
  );
}

export default function UsageView() {
  const stats = useUsageStats();
  const [tab, setTab] = useState<UsageTab>('logs');
  const rangeLabel = t(RANGE_OPTIONS.find((option) => option.value === stats.range)!.label);

  const clearUsage = () => {
    stats.clear();
    useToastStore.getState().addToast(t('Usage data cleared'), 'success');
  };

  return (
    <div data-testid="usage-page" className="usage-page scroll-region" style={{
      flex: 1, minHeight: 0, overflowY: 'auto', padding: '18px 22px 24px',
      background: 'var(--canvas)', userSelect: 'none', display: 'flex', flexDirection: 'column', gap: 14,
    }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <DataUsage size={iconSizes.row} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
        <strong style={{ color: 'var(--text-primary)', fontSize: 'var(--fs-subtitle)', fontWeight: 'var(--fw-semibold)' }}>
          {t('Usage statistics')}
        </strong>
        <Info size={13} style={{ color: 'var(--text-muted)' }}
          data-tip={t('Usage statistics')}
          data-tip-description={t('Requests and token usage the provider reported on this machine.')} />
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 'var(--fs-caption)' }}>
          <span data-testid="usage-record-count">{t('{{count}} records', { count: stats.records.length })}</span>
          {stats.latestAt > 0 && <span>· {t('Latest {{time}}', { time: formatLogTime(stats.latestAt) })}</span>}
          <IconButton compact tone="danger" data-testid="usage-clear" disabled={stats.records.length === 0}
            aria-label={t('Clear usage data')} data-tip={t('Clear usage data')} onClick={clearUsage}>
            <Trash2 size={iconSizes.compact} />
          </IconButton>
        </span>
      </header>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <FilterSelect label={t('Provider')} testId="usage-filter-provider" value={stats.provider}
            options={[{ value: ALL_FILTER, label: t('All') }, ...stats.providerOptions.map((option) => ({ value: option, label: option }))]}
            onChange={stats.setProvider} />
          <FilterSelect label={t('Model')} testId="usage-filter-model" value={stats.model}
            options={[{ value: ALL_FILTER, label: t('All') }, ...stats.modelOptions.map((option) => ({ value: option, label: option }))]}
            onChange={stats.setModel} />
          <FilterSelect label={t('Usage range')} testId="usage-range" value={stats.range}
            options={RANGE_OPTIONS.map((option) => ({ value: option.value, label: t(option.label) }))}
            onChange={(next) => stats.setRange(next as UsageRange)} />
        </span>
      </div>

      <MetricsRow totals={stats.totals} />

      <TrendChart buckets={stats.series.buckets} unit={stats.series.unit} rangeLabel={rangeLabel} />

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
        <p style={{ margin: '10px 2px 0', color: 'var(--text-muted)', fontSize: 'var(--fs-micro)', lineHeight: 1.6 }}>
          {t('Counts are reported by the provider. Titles, command completion and context summaries are not counted yet.')}
        </p>
      </section>
    </div>
  );
}
