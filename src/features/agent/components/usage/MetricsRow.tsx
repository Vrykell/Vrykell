/**
 * MetricsRow — the headline numbers of the usage page.
 *
 * One card style for every metric, all visible at once: total tokens, requests, fresh input,
 * cache hit rate, output, cache reads, steps and tool calls. The grid stays at four columns
 * whatever the window width (two rows), so card positions never move; a narrow page truncates
 * the label instead, and the tooltip keeps the full text. The card itself is shared with the
 * ACP server view (see MetricCard).
 */
import { t } from '@i18n';
import {
  cacheHitRate,
  formatCompact,
  formatTokens,
  freshInputTokens,
  realTokens,
  type UsageTotals,
} from '@features/agent/model/usageStats';
import MetricCard from './MetricCard';

/** Whole numbers from 99.95% up, one decimal below. */
function hitRateLabel(totals: UsageTotals): string {
  if (totals.inputTokens <= 0) return '—';
  const percent = cacheHitRate(totals) * 100;
  return `${percent >= 99.95 ? Math.round(percent) : percent.toFixed(1)}%`;
}

export default function MetricsRow({ totals }: { totals: UsageTotals }) {
  const cards: Array<{ key: string; testId: string; label: string; value: string; exact?: string; hint?: string }> = [
    {
      key: 'tokens', testId: 'usage-total-tokens', label: t('Total tokens'), value: formatCompact(realTokens(totals)),
      exact: formatTokens(realTokens(totals)),
      hint: t('Prompt and completion tokens as the provider reported them.'),
    },
    { key: 'requests', testId: 'usage-total-requests', label: t('Requests'), value: formatTokens(totals.turns) },
    {
      key: 'fresh-input', testId: 'usage-fresh-input', label: t('Fresh input'), value: formatCompact(freshInputTokens(totals)),
      exact: formatTokens(freshInputTokens(totals)),
      hint: t('Fresh input excludes the prompt tokens served from cache.'),
    },
    {
      key: 'cache-hit', testId: 'usage-cache-hit', label: t('Cache hit rate'), value: hitRateLabel(totals),
      hint: t('Cache hit rate is the share of prompt tokens the provider served from its cache.'),
    },
    {
      key: 'output', testId: 'usage-output', label: t('Output'), value: formatCompact(totals.outputTokens),
      exact: formatTokens(totals.outputTokens),
    },
    {
      key: 'cache-read', testId: 'usage-cache-read', label: t('Cache read'), value: formatCompact(totals.cachedInputTokens),
      exact: formatTokens(totals.cachedInputTokens),
      hint: t('Prompt tokens the provider served from its cache.'),
    },
    { key: 'steps', testId: 'usage-steps', label: t('Steps'), value: formatTokens(totals.steps) },
    { key: 'tool-calls', testId: 'usage-tool-calls', label: t('Tool calls'), value: formatTokens(totals.toolCalls) },
  ];

  return (
    <section aria-label={t('Usage summary')} data-testid="usage-metrics"
      style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
      {cards.map((card) => (
        <MetricCard key={card.key} testId={card.testId} label={card.label}
          value={card.value} exact={card.exact} hint={card.hint} />
      ))}
    </section>
  );
}
