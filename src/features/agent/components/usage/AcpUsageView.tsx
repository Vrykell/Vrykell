/**
 * AcpUsageView — the usage page while one ACP server is the selected source.
 *
 * An ACP server reports its sessions: turns, tool calls, the context window in use and the
 * cumulative cost, and nothing per turn. So this view shows exactly those numbers — the token
 * cards, the trend chart and the token tables would only read zero here and are left out.
 */
import { t } from '@i18n';
import { formatCompact, formatLogTime, formatTokens, type AcpUsageRecord } from '@features/agent/model/usageStats';
import HarnessBadge from '@features/agent/components/HarnessBadge';
import MetricCard from './MetricCard';

export default function AcpUsageView({ row }: { row: AcpUsageRecord }) {
  // Both numbers stay visible: the compact pair fits a card, and the exact counts sit in the title.
  const context = row.contextSize > 0
    ? `${formatCompact(row.contextUsed)}/${formatCompact(row.contextSize)}`
    : formatCompact(row.contextUsed);
  const contextExact = row.contextSize > 0
    ? `${formatTokens(row.contextUsed)} / ${formatTokens(row.contextSize)}`
    : formatTokens(row.contextUsed);
  return (
    <section data-testid="usage-acp" aria-label={t('ACP sessions')} className="usage-card"
      style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <HarnessBadge name={row.source} size={24} />
        <strong style={{
          color: 'var(--text-primary)', fontSize: 'var(--fs-subtitle)', fontWeight: 'var(--fw-semibold)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {row.source}
        </strong>
        <span data-testid="usage-acp-updated" style={{
          marginLeft: 'auto', color: 'var(--text-muted)', fontSize: 'var(--fs-caption)', flexShrink: 0,
        }}>
          {t('Latest update {{time}}', { time: formatLogTime(row.at) })}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
        <MetricCard testId="usage-acp-turns" label={t('Turns')} value={formatTokens(row.turns)} />
        <MetricCard testId="usage-acp-tool-calls" label={t('Tool calls')} value={formatTokens(row.toolCalls)} />
        {(row.contextUsed > 0 || row.contextSize > 0) && (
          <MetricCard testId="usage-acp-context" label={t('Context usage')} value={context} exact={contextExact}
            hint={t('Context tokens in use, as the agent reported them.')} />
        )}
        {row.cost !== null && (
          <MetricCard testId="usage-acp-cost"
            label={row.currency ? `${t('Cumulative cost')} (${row.currency})` : t('Cumulative cost')}
            value={row.cost.toFixed(4)} exact={`${row.cost.toFixed(4)} ${row.currency}`.trim()}
            hint={t('The cost the agent reported for its sessions.')} />
        )}
      </div>

      <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-caption)' }}>
        {t('The agent reports its session totals: turns, tool calls, context and cost. Per-turn token counts are not part of the protocol.')}
      </span>
    </section>
  );
}
