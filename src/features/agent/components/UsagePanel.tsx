/**
 * UsagePanel — request, token and cost accounting for AI turns.
 *
 * Layout follows the web console's usage page: a total cost headline, a cost-per-hour/day
 * chart, a per-model breakdown with cost, and the recent requests. Numbers come from the
 * provider's own usage report (see `agentStream`); cost is estimated from the built-in price
 * list (`model/pricing.ts`) and a model the list does not know is left out and called out,
 * never guessed. Auxiliary calls (titles, completion, context summaries) are not counted yet.
 */
import { t, type I18nKey } from '@i18n';
import { useToastStore } from '@ui/Toast';
import { IconButton } from '@ui/IconButton';
import Select from '@ui/Select';
import { Trash2, iconSizes } from '@ui/icons';
import { formatMessageTime } from '@utils/formatTime';
import {
  formatCompact,
  formatTokens,
  totalTokens,
  type CostBucket,
  type UsageRange,
} from '@features/agent/model/usageStats';
import { formatUsd } from '@features/agent/model/pricing';
import { useUsageStats, type UsageStats } from '@features/agent/hooks/useUsageStats';

const RANGE_OPTIONS: Array<{ value: UsageRange; label: I18nKey }> = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'all', label: 'All time' },
];

const MUTED = 'var(--text-muted)';
const CAPTION = 'var(--fs-caption)';
const MICRO = 'var(--fs-micro)';

function SectionTitle({ children }: { children: string }) {
  return (
    <div style={{
      padding: '14px 12px 6px', color: MUTED,
      fontSize: MICRO, letterSpacing: '0.04em', textTransform: 'uppercase',
    }}>
      {children}
    </div>
  );
}

/** Total cost is the headline the console leads with, so it gets the largest type. */
function CostHeadline({ stats }: { stats: UsageStats }) {
  const { totals } = stats;
  return (
    <div data-testid="usage-total-cost-block" style={{ padding: '4px 12px 10px' }}>
      <div style={{ color: MUTED, fontSize: MICRO, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
        {t('Total cost')}
      </div>
      <div data-testid="usage-total-cost" style={{
        marginTop: 2, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)',
        fontSize: 'calc(24px * var(--ui-font-scale))', lineHeight: 1.2, userSelect: 'text',
      }}>
        {formatUsd(totals.costUsd)}
      </div>
      <div data-testid="usage-cost-caption" style={{ marginTop: 4, color: MUTED, fontSize: CAPTION }}>
        {t('{{count}} requests', { count: totals.turns })} · {t('{{tokens}} tokens', { tokens: formatCompact(totalTokens(totals)) })}
        {totals.unknownCostTurns > 0 && (
          <span style={{ color: 'var(--accent-warm)' }}>
            {' · '}{t('{{count}} requests have no known price', { count: totals.unknownCostTurns })}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Cost per hour (today) or per day (wider ranges) as bars: the console charts the same series
 * with a gradient area, and bars keep sparse data readable at panel width.
 */
function CostChart({ buckets, unit, peak }: { buckets: CostBucket[]; unit: 'hour' | 'day'; peak: number }) {
  const width = 100;
  const height = 32;
  const slot = width / Math.max(buckets.length, 1);
  const scale = peak > 0 ? peak : 1;
  return (
    <div style={{ padding: '0 12px' }}>
      <svg
        data-testid="usage-cost-chart" role="img" aria-label={t('Cost chart for the selected range')}
        viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none"
        style={{ display: 'block', width: '100%', height: 56, overflow: 'visible' }}
      >
        <rect x={0} y={height - 0.6} width={width} height={0.6} fill="var(--border)" />
        {buckets.map((bucket, index) => {
          const barHeight = bucket.turns > 0 ? Math.max(2, (bucket.costUsd / scale) * (height - 2)) : 0.6;
          return (
            <rect
              key={bucket.start}
              x={index * slot + slot * 0.18} y={height - barHeight}
              width={Math.max(slot * 0.64, 0.6)} height={barHeight} rx={0.8}
              fill={bucket.turns > 0 ? 'var(--accent)' : 'var(--border)'}
              opacity={bucket.turns > 0 ? 0.9 : 0.6}
            >
              <title>{`${bucket.label} · ${formatUsd(bucket.costUsd)} · ${formatTokens(bucket.tokens)} tokens`}</title>
            </rect>
          );
        })}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', color: MUTED, fontSize: MICRO, paddingTop: 2 }}>
        <span>{buckets[0]?.label ?? ''}</span>
        <span data-testid="usage-cost-peak">{t('Peak {{cost}}', { cost: formatUsd(peak) })}</span>
        <span>{buckets[buckets.length - 1]?.label ?? ''}</span>
      </div>
      <div style={{ color: MUTED, fontSize: MICRO, paddingTop: 2 }}>{unit === 'hour' ? t('Hourly cost') : t('Daily cost')}</div>
    </div>
  );
}

function ModelTable({ stats }: { stats: UsageStats }) {
  const header: Array<{ label: I18nKey; align: 'left' | 'right'; width?: number }> = [
    { label: 'Model', align: 'left' },
    { label: 'Requests', align: 'right', width: 44 },
    { label: 'Input', align: 'right', width: 46 },
    { label: 'Output', align: 'right', width: 46 },
    { label: 'Cost', align: 'right', width: 58 },
  ];
  return (
    <div style={{ padding: '0 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
        {header.map((cell) => (
          <span key={cell.label} style={{
            flex: cell.width ? `0 0 ${cell.width}px` : 1, minWidth: 0, textAlign: cell.align,
            color: MUTED, fontSize: MICRO, textTransform: 'uppercase', letterSpacing: '0.03em',
          }}>
            {t(cell.label)}
          </span>
        ))}
      </div>
      {stats.models.map((row) => (
        <div key={row.key} data-testid="usage-model-row" data-model={row.model} style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '6px 0',
          borderBottom: '1px solid var(--border)',
        }}>
          <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-primary)', fontSize: CAPTION }}>
              {row.model}
            </span>
            <span data-testid="usage-model-secondary" style={{ color: MUTED, fontSize: MICRO }}>
              {row.provider}
              {row.cachedInputTokens > 0 && ` · ${t('Cache read')} ${formatCompact(row.cachedInputTokens)}`}
            </span>
          </span>
          <span data-testid="usage-model-requests" style={{ flex: '0 0 44px', textAlign: 'right', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', fontSize: MICRO, userSelect: 'text' }}>
            {row.turns}
          </span>
          <span data-testid="usage-model-input" style={{ flex: '0 0 46px', textAlign: 'right', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', fontSize: MICRO, userSelect: 'text' }}>
            {formatCompact(row.inputTokens)}
          </span>
          <span data-testid="usage-model-output" style={{ flex: '0 0 46px', textAlign: 'right', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', fontSize: MICRO, userSelect: 'text' }}>
            {formatCompact(row.outputTokens)}
          </span>
          <span data-testid="usage-model-cost" style={{ flex: '0 0 58px', textAlign: 'right', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: MICRO, userSelect: 'text' }}>
            {row.unknownCostTurns === row.turns ? '—' : formatUsd(row.costUsd)}
          </span>
        </div>
      ))}
    </div>
  );
}

function UsageBody({ stats }: { stats: UsageStats }) {
  const { recent, series } = stats;
  const peak = Math.max(...series.buckets.map((bucket) => bucket.costUsd), 0);
  return (
    <>
      <CostHeadline stats={stats} />
      <SectionTitle>{series.unit === 'hour' ? t('Hourly cost') : t('Daily cost')}</SectionTitle>
      <CostChart buckets={series.buckets} unit={series.unit} peak={peak} />
      <SectionTitle>{t('By model')}</SectionTitle>
      <ModelTable stats={stats} />

      <SectionTitle>{t('Recent requests')}</SectionTitle>
      {recent.map((record) => (
        <div key={record.id} data-testid="usage-recent-row" style={{
          display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, padding: '5px 12px',
        }}>
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-secondary)', fontSize: CAPTION }}>
            {record.model}
          </span>
          <span style={{ flexShrink: 0, color: MUTED, fontSize: MICRO }}>
            {formatMessageTime(record.at)} · {formatCompact(totalTokens(record))} · {record.costUsd == null ? '—' : formatUsd(record.costUsd)}
          </span>
        </div>
      ))}

      <div style={{ padding: '10px 12px 0', color: MUTED, fontSize: MICRO, lineHeight: 1.6 }}>
        {t('Cost is estimated from the built-in price list; models without a price are left out of the total.')}
        <br />
        {t('Counts are reported by the provider. Titles, command completion and context summaries are not counted yet.')}
      </div>
    </>
  );
}

export default function UsagePanel() {
  const stats = useUsageStats();
  const empty = stats.records.length === 0;

  const clearUsage = () => {
    stats.clear();
    useToastStore.getState().addToast(t('Usage data cleared'), 'success');
  };

  return (
    <div data-testid="usage-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, userSelect: 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px' }}>
        <Select aria-label={t('Usage range')} data-testid="usage-range"
          value={stats.range} onChange={stats.setRange}
          options={RANGE_OPTIONS.map((option) => ({ value: option.value, label: t(option.label) }))}
          style={{ flex: 1, minWidth: 0 }} />
        <IconButton compact tone="danger" disabled={empty} data-testid="usage-clear"
          aria-label={t('Clear usage data')} data-tip={t('Clear usage data')} onClick={clearUsage}>
          <Trash2 size={iconSizes.compact} />
        </IconButton>
      </div>

      <div className="scroll-region" style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingBottom: 12 }}>
        {empty ? (
          <div data-testid="usage-empty" style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '28px 16px', textAlign: 'center', color: MUTED }}>
            <strong style={{ color: 'var(--text-primary)', fontSize: 'var(--fs-label)', fontWeight: 'var(--fw-semibold)' }}>{t('No usage yet')}</strong>
            <span style={{ fontSize: CAPTION, lineHeight: 1.6 }}>{t('No usage was recorded in this range.')}</span>
          </div>
        ) : (
          <UsageBody stats={stats} />
        )}
      </div>
    </div>
  );
}
