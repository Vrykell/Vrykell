/**
 * MetricsRow — the headline numbers of the usage page.
 *
 * Four cards like the reference dashboard (total tokens, requests, fresh input, cache hit rate),
 * with "more metrics" unfolding output, cache reads, steps and tool calls. Every card carries a
 * tooltip that spells out the counting rule; the exact number stays in the title attribute.
 */
import { useState } from 'react';
import { t } from '@i18n';
import { Info } from '@ui/icons';
import {
  cacheHitRate,
  formatCompact,
  formatTokens,
  freshInputTokens,
  realTokens,
  type UsageTotals,
} from '@features/agent/model/usageStats';

/** Whole numbers from 99.95% up, one decimal below. */
function hitRateLabel(totals: UsageTotals): string {
  if (totals.inputTokens <= 0) return '—';
  const percent = cacheHitRate(totals) * 100;
  return `${percent >= 99.95 ? Math.round(percent) : percent.toFixed(1)}%`;
}

function MetricCard({ label, value, exact, hint, testId }: {
  label: string;
  value: string;
  exact?: string;
  hint?: string;
  testId: string;
}) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 6,
      minWidth: 0, minHeight: 76, padding: '12px 14px',
      border: '1px solid var(--border)', borderRadius: 'var(--radius-block)', background: 'var(--surface)',
    }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0, color: 'var(--text-secondary)', fontSize: 'var(--fs-caption)' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        {hint && <Info size={12} style={{ flexShrink: 0, color: 'var(--text-muted)' }}
          data-tip={label} data-tip-description={hint} />}
      </span>
      <span data-testid={testId} title={exact} style={{
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        color: 'var(--text-primary)', fontFamily: 'var(--font-mono)',
        fontSize: 'calc(21px * var(--ui-font-scale))', lineHeight: 1.2, userSelect: 'text',
      }}>
        {value}
      </span>
    </div>
  );
}

function MiniMetric({ label, value, exact }: { label: string; value: string; exact?: string }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, padding: '8px 14px',
      borderRadius: 'var(--radius-block)', background: 'var(--hover)',
    }}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-secondary)', fontSize: 'var(--fs-caption)' }}>
        {label}
      </span>
      <span title={exact} style={{
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-label)',
        fontVariantNumeric: 'tabular-nums', userSelect: 'text',
      }}>
        {value}
      </span>
    </div>
  );
}

export default function MetricsRow({ totals }: { totals: UsageTotals }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const hitHint = t('Cache hit rate is the share of prompt tokens the provider served from its cache.');
  const totalHint = t('Prompt and completion tokens as the provider reported them.');

  return (
    <section aria-label={t('Usage summary')} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1, minWidth: 0 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
          <MetricCard testId="usage-total-tokens" label={t('Total tokens')}
            value={formatCompact(realTokens(totals))} exact={formatTokens(realTokens(totals))} hint={totalHint} />
          <MetricCard testId="usage-total-requests" label={t('Requests')}
            value={formatTokens(totals.turns)} />
          <MetricCard testId="usage-fresh-input" label={t('Fresh input')}
            value={formatCompact(freshInputTokens(totals))} exact={formatTokens(freshInputTokens(totals))}
            hint={t('Fresh input excludes the prompt tokens served from cache.')} />
          <MetricCard testId="usage-cache-hit" label={t('Cache hit rate')} value={hitRateLabel(totals)} hint={hitHint} />
        </div>
        {moreOpen && (
          <div data-testid="usage-extra-metrics" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
            <MiniMetric label={t('Output')} value={formatCompact(totals.outputTokens)} exact={formatTokens(totals.outputTokens)} />
            <MiniMetric label={t('Cache read')} value={formatCompact(totals.cachedInputTokens)} exact={formatTokens(totals.cachedInputTokens)} />
            <MiniMetric label={t('Steps')} value={formatTokens(totals.steps)} />
            <MiniMetric label={t('Tool calls')} value={formatTokens(totals.toolCalls)} />
          </div>
        )}
      </div>
      <button type="button" data-subtle data-testid="usage-more-metrics" aria-expanded={moreOpen}
        onClick={() => setMoreOpen((open) => !open)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0, padding: '6px 8px',
          border: 0, borderRadius: 'var(--radius-inner)', background: 'transparent',
          color: 'var(--text-secondary)', font: `var(--fs-caption) var(--font-ui)`, cursor: 'pointer',
        }}>
        {t('More metrics')}
      </button>
    </section>
  );
}
