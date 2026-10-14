/**
 * TrendChart — bars per hour (today) or per day (wider ranges) with a metric switch.
 *
 * Mirrors the reference dashboard's chart card: title with the selected range, a Tokens /
 * Requests switch on the right, three grid lines with compact labels on the left and the bucket
 * labels along the bottom. Drawn as plain SVG so the page needs no chart dependency; each bar
 * carries its own hover title.
 */
import { useState } from 'react';
import { t } from '@i18n';
import {
  formatCompact,
  formatTokens,
  type UsageBucket,
} from '@features/agent/model/usageStats';

export type TrendMetric = 'tokens' | 'requests';

const CHART_HEIGHT = 88;

/** Evenly spaced tick indexes so labels never crowd (the reference labels every bucket when they fit). */
function tickIndexes(count: number, max: number = 8): number[] {
  if (count <= max) return Array.from({ length: count }, (_, index) => index);
  const step = Math.ceil(count / max);
  const indexes: number[] = [];
  for (let index = 0; index < count; index += step) indexes.push(index);
  if (indexes[indexes.length - 1] !== count - 1) indexes.push(count - 1);
  return indexes;
}

export default function TrendChart({ buckets, unit, rangeLabel }: {
  buckets: UsageBucket[];
  unit: 'hour' | 'day';
  rangeLabel: string;
}) {
  const [metric, setMetric] = useState<TrendMetric>('tokens');
  const valueOf = (bucket: UsageBucket) => (metric === 'tokens' ? bucket.tokens : bucket.turns);
  const peak = Math.max(...buckets.map(valueOf), 0);
  const scale = peak > 0 ? peak : 1;
  const slot = 100 / Math.max(buckets.length, 1);
  const ticks = tickIndexes(buckets.length);

  return (
    <section className="usage-card" aria-label={t('Usage trend')} data-testid="usage-trend">
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between', padding: '2px 2px 10px' }}>
        <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
          <strong style={{ color: 'var(--text-primary)', fontSize: 'var(--fs-label)', fontWeight: 'var(--fw-semibold)' }}>
            {t('Usage trend')}
          </strong>
          <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-caption)' }}>· {rangeLabel}</span>
        </span>
        <span role="tablist" aria-label={t('Chart metric')} style={{
          display: 'inline-flex', gap: 2, padding: 2, borderRadius: 'var(--radius-inner)', background: 'var(--hover)',
        }}>
          {(['tokens', 'requests'] as const).map((option) => (
            <button key={option} type="button" role="tab" aria-selected={metric === option}
              data-subtle data-testid={`usage-metric-${option}`}
              onClick={() => setMetric(option)}
              style={{
                padding: '3px 10px', border: 0, borderRadius: 'var(--radius-inner)',
                background: metric === option ? 'var(--surface)' : 'transparent',
                color: metric === option ? 'var(--text-primary)' : 'var(--text-secondary)',
                font: `${'var(--fs-caption)'} var(--font-ui)`, cursor: 'pointer',
                transition: 'background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease)',
              }}>
              {option === 'tokens' ? t('Tokens') : t('Requests')}
            </button>
          ))}
        </span>
      </header>

      <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
        {/* 左侧刻度：峰值 / 半值 / 0，与参考面板一致 */}
        <div aria-hidden="true" style={{
          display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
          width: 52, textAlign: 'right', color: 'var(--text-muted)', fontSize: 'var(--fs-micro)',
          fontVariantNumeric: 'tabular-nums', flexShrink: 0,
        }}>
          <span>{formatCompact(peak)}</span>
          <span>{formatCompact(peak / 2)}</span>
          <span>0</span>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <svg data-testid="usage-trend-chart" role="img"
            aria-label={t('{{metric}} over time', { metric: metric === 'tokens' ? t('Tokens') : t('Requests') })}
            viewBox={`0 0 100 ${CHART_HEIGHT}`} preserveAspectRatio="none"
            style={{ display: 'block', width: '100%', height: CHART_HEIGHT, overflow: 'visible' }}>
            {[0, 0.5, 1].map((fraction) => (
              <line key={fraction} x1={0} x2={100} y1={CHART_HEIGHT * fraction} y2={CHART_HEIGHT * fraction}
                stroke="var(--border)" strokeWidth={0.4} />
            ))}
            {buckets.map((bucket, index) => {
              const value = valueOf(bucket);
              const barHeight = value > 0 ? Math.max(1.5, (value / scale) * (CHART_HEIGHT - 1)) : 0;
              return (
                <rect key={bucket.start}
                  x={index * slot + slot * 0.28} y={CHART_HEIGHT - barHeight}
                  width={Math.max(slot * 0.44, 0.6)} height={barHeight} rx={0.6}
                  fill="var(--accent)" opacity={value > 0 ? 0.92 : 0}>
                  <title>
                    {`${bucket.label} · ${metric === 'tokens' ? `${formatTokens(bucket.tokens)} tokens` : t('{{count}} requests', { count: bucket.turns })}`}
                  </title>
                </rect>
              );
            })}
          </svg>
          <div style={{ position: 'relative', height: 14, marginTop: 4 }}>
            {ticks.map((index) => (
              <span key={index} style={{
                position: 'absolute', left: `${index * slot + slot / 2}%`, transform: 'translateX(-50%)',
                color: 'var(--text-muted)', fontSize: 'var(--fs-micro)', whiteSpace: 'nowrap',
                fontVariantNumeric: 'tabular-nums',
              }}>
                {buckets[index]!.label}
              </span>
            ))}
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-micro)', marginTop: 2 }}>
            {unit === 'hour' ? t('Per hour') : t('Per day')}
          </div>
        </div>
      </div>
    </section>
  );
}
