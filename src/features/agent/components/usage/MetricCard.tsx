/**
 * MetricCard — the usage page's single card style.
 *
 * Every headline number on the page uses it: the token metrics and, when one ACP server is
 * selected, that server's own report. A card whose counting rule needs explaining carries the
 * rule on the label's hover tip; the exact number stays in the value's title attribute.
 */

export default function MetricCard({ label, value, exact, hint, testId }: {
  label: string;
  value: string;
  exact?: string;
  hint?: string;
  testId: string;
}) {
  return (
    <div className="usage-card" style={{
      display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 6,
      minWidth: 0, minHeight: 76,
    }}>
      <span data-tip={hint ? label : undefined} data-tip-description={hint}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0, color: 'var(--text-secondary)', fontSize: 'var(--fs-caption)' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
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
