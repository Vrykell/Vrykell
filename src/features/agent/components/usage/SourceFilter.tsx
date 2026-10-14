/**
 * SourceFilter — which agent reported the shown turns.
 *
 * This app's own agent is the only source today; harnesses connected through ACP will report their
 * own name and appear here as they start producing turns. Shaped like the reference dashboard's
 * selector: one segmented bar whose first chip is "All" and whose remaining chips are icon-only
 * with the name in the hover tip.
 */
import { t } from '@i18n';
import { Bot, Terminal, iconSizes } from '@ui/icons';
import { ALL_FILTER } from '@features/agent/hooks/useUsageStats';
import { DEFAULT_USAGE_SOURCE } from '@features/agent/model/usageStats';

/** This app has a name; a connected harness reports its own. */
export function sourceLabel(source: string): string {
  return source === DEFAULT_USAGE_SOURCE ? t('Vrykell') : source;
}

export default function SourceFilter({ value, options, onChange }: {
  value: string;
  options: string[];
  onChange: (next: string) => void;
}) {
  return (
    <div className="usage-source-filter" role="group" aria-label={t('Usage source')}>
      <button type="button" data-subtle className="usage-source-chip" data-testid="usage-source-all"
        aria-pressed={value === ALL_FILTER} onClick={() => onChange(ALL_FILTER)}>
        {t('All')}
      </button>
      {options.map((source) => {
        // A connected harness has no mark of its own yet, so it shares a generic one.
        const Glyph = source === DEFAULT_USAGE_SOURCE ? Bot : Terminal;
        const label = sourceLabel(source);
        return (
          <button key={source} type="button" data-subtle className="usage-source-chip usage-source-chip--icon"
            data-testid={`usage-source-${source}`} aria-label={label} aria-pressed={value === source}
            data-tip={label} onClick={() => onChange(value === source ? ALL_FILTER : source)}>
            <Glyph size={iconSizes.compact} />
          </button>
        );
      })}
    </div>
  );
}
