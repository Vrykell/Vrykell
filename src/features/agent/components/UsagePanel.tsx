/**
 * UsagePanel — token accounting for AI turns, shown as a side panel.
 *
 * Numbers come from the provider's own usage report (see `agentStream`), so the panel
 * shows what was actually billed rather than a local estimate. The footer states what
 * is not counted yet, instead of implying the totals are complete.
 */
import { t, type I18nKey } from '@i18n';
import { useToastStore } from '@ui/Toast';
import { IconButton } from '@ui/IconButton';
import Select from '@ui/Select';
import { Trash2, iconSizes } from '@ui/icons';
import { formatMessageTime } from '@utils/formatTime';
import { formatTokens, totalTokens, type UsageRange } from '@features/agent/model/usageStats';
import { useUsageStats, type UsageStats } from '@features/agent/hooks/useUsageStats';

const RANGE_OPTIONS: Array<{ value: UsageRange; label: I18nKey }> = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'all', label: 'All time' },
];

function SectionTitle({ children }: { children: string }) {
  return (
    <div style={{
      padding: '12px 12px 4px', color: 'var(--text-muted)',
      fontSize: 'var(--fs-micro)', letterSpacing: '0.04em', textTransform: 'uppercase',
    }}>
      {children}
    </div>
  );
}

function StatRow({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, padding: '5px 12px' }}>
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-secondary)', fontSize: 'var(--fs-caption)' }}>
        {label}
      </span>
      <span data-testid={testId} style={{ flexShrink: 0, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-caption)', userSelect: 'text' }}>
        {value}
      </span>
    </div>
  );
}

/** Label line with a dimmed second line, used by the model and recent lists. */
function ListRow({ primary, secondary, value, testId, attributes }: {
  primary: string;
  secondary: string;
  value: string;
  testId: string;
  attributes?: Record<string, string>;
}) {
  return (
    <div {...attributes} data-testid={testId} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, padding: '6px 12px', borderTop: '1px solid var(--border)' }}>
      <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-primary)', fontSize: 'var(--fs-caption)' }}>{primary}</span>
        <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-micro)' }}>{secondary}</span>
      </span>
      <span style={{ flexShrink: 0, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-micro)', userSelect: 'text' }}>{value}</span>
    </div>
  );
}

function UsageBody({ stats }: { stats: UsageStats }) {
  const { totals, models, recent } = stats;
  return (
    <>
      <SectionTitle>{t('Summary')}</SectionTitle>
      <StatRow label={t('Requests')} value={formatTokens(totals.turns)} testId="usage-turns" />
      <StatRow label={t('Total tokens')} value={formatTokens(totalTokens(totals))} testId="usage-total-tokens" />
      <StatRow label={t('Input tokens')} value={formatTokens(totals.inputTokens)} testId="usage-input-tokens" />
      <StatRow label={t('Output tokens')} value={formatTokens(totals.outputTokens)} testId="usage-output-tokens" />
      {totals.cachedInputTokens > 0 && (
        <StatRow label={t('Cached input')} value={formatTokens(totals.cachedInputTokens)} testId="usage-cached-tokens" />
      )}
      {totals.reasoningTokens > 0 && (
        <StatRow label={t('Reasoning tokens')} value={formatTokens(totals.reasoningTokens)} testId="usage-reasoning-tokens" />
      )}
      <StatRow label={t('Tool calls')} value={formatTokens(totals.toolCalls)} testId="usage-tool-calls" />
      <StatRow label={t('Steps')} value={formatTokens(totals.steps)} testId="usage-steps" />

      <SectionTitle>{t('By model')}</SectionTitle>
      {models.map((row) => (
        <ListRow key={row.key} testId="usage-model-row" attributes={{ 'data-model': row.model }}
          primary={row.model} secondary={t('{{count}} requests', { count: row.turns })}
          value={`${formatTokens(row.inputTokens)} / ${formatTokens(row.outputTokens)}`} />
      ))}

      <SectionTitle>{t('Recent requests')}</SectionTitle>
      {recent.map((record) => (
        <ListRow key={record.id} testId="usage-recent-row"
          primary={record.model} secondary={formatMessageTime(record.at)}
          value={`${formatTokens(totalTokens(record))} · ${t('{{count}} steps', { count: record.steps })}`} />
      ))}
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

      <div className="scroll-region" style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingBottom: 8 }}>
        {empty ? (
          <div data-testid="usage-empty" style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '28px 16px', textAlign: 'center', color: 'var(--text-muted)' }}>
            <strong style={{ color: 'var(--text-primary)', fontSize: 'var(--fs-label)', fontWeight: 'var(--fw-semibold)' }}>{t('No usage yet')}</strong>
            <span style={{ fontSize: 'var(--fs-caption)', lineHeight: 1.6 }}>{t('Token counts appear here after an assistant request.')}</span>
          </div>
        ) : (
          <UsageBody stats={stats} />
        )}
        <div style={{ padding: '10px 12px 0', color: 'var(--text-muted)', fontSize: 'var(--fs-micro)', lineHeight: 1.6 }}>
          {t('Counts are reported by the provider. Titles, command completion and context summaries are not counted yet.')}
        </div>
      </div>
    </div>
  );
}
