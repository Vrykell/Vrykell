/**
 * AcpUsageSection — what the connected ACP servers report about their own sessions.
 *
 * The protocol reports the context window in use and the cumulative cost, not per-turn token
 * counts, so this stays a section of its own instead of faking columns in the token tables.
 */
import { t } from '@i18n';
import { formatCompact, type AcpUsageRecord } from '@features/agent/model/usageStats';
import HarnessBadge from '@features/agent/components/HarnessBadge';

export default function AcpUsageSection({ rows }: { rows: AcpUsageRecord[] }) {
  if (rows.length === 0) return null;
  return (
    <section data-testid="usage-acp" className="usage-card" style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
      <span style={{ color: 'var(--text-primary)', fontSize: 'var(--fs-label)', fontWeight: 'var(--fw-semibold)' }}>
        {t('ACP sessions')}
      </span>
      {rows.map((row) => (
        <div key={row.source} style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <HarnessBadge name={row.source} size={22} />
          <span style={{
            flex: 1, minWidth: 0, color: 'var(--text-primary)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {row.source}
          </span>
          <span style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-caption)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
            {t('{{count}} turns', { count: row.turns })} · {t('{{count}} tool calls', { count: row.toolCalls })}
          </span>
          {row.contextSize > 0 && (
            <span data-tip={t('Context window in use')} style={{
              color: 'var(--text-muted)', fontSize: 'var(--fs-caption)',
              fontVariantNumeric: 'tabular-nums', flexShrink: 0,
            }}>
              {formatCompact(row.contextUsed)} / {formatCompact(row.contextSize)}
            </span>
          )}
          {row.cost !== null && (
            <span style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-caption)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
              {row.cost.toFixed(4)} {row.currency}
            </span>
          )}
        </div>
      ))}
    </section>
  );
}
