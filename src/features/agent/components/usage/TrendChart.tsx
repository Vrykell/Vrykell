/**
 * TrendChart — bars per hour (today) or per day (wider ranges) with a metric switch.
 *
 * Mirrors the reference dashboard's chart card: blue bars with a small top radius, the hovered
 * column highlighted behind its bar, a tooltip card that spells out the full timestamp and the
 * value, and a Tokens / Requests switch in the header. Drawn as plain SVG in pixel space (the
 * container width is measured) so the bar radius stays round; no chart dependency.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { t } from '@i18n';
import {
  formatCompact,
  formatTokens,
  type UsageBucket,
} from '@features/agent/model/usageStats';

export type TrendMetric = 'tokens' | 'requests';

const CHART_HEIGHT = 88;
/** Bars never grow wider than the reference's maxBarSize. */
const MAX_BAR_WIDTH = 36;
const BAR_RADIUS = 3;
/** Logical width used before the container is measured (jsdom never measures). */
const FALLBACK_WIDTH = 640;

/** Evenly spaced tick indexes so labels never crowd. */
function tickIndexes(count: number, max: number = 8): number[] {
  if (count <= max) return Array.from({ length: count }, (_, index) => index);
  const step = Math.ceil(count / max);
  const indexes: number[] = [];
  for (let index = 0; index < count; index += step) indexes.push(index);
  if (indexes[indexes.length - 1] !== count - 1) indexes.push(count - 1);
  return indexes;
}

/** Tooltip heading: 2026/10/14 06:00. */
function bucketStamp(start: number): string {
  const date = new Date(start);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:00`;
}

export default function TrendChart({ buckets, unit, rangeLabel }: {
  buckets: UsageBucket[];
  unit: 'hour' | 'day';
  rangeLabel: string;
}) {
  const [metric, setMetric] = useState<TrendMetric>('tokens');
  const [hovered, setHovered] = useState<number | null>(null);
  const [width, setWidth] = useState(FALLBACK_WIDTH);
  const plotRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = plotRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const next = element.getBoundingClientRect().width;
      if (next > 40) setWidth(next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => setHovered(null), [buckets]);

  const valueOf = (bucket: UsageBucket) => (metric === 'tokens' ? bucket.tokens : bucket.turns);
  const formatValue = (value: number) =>
    metric === 'tokens' ? `${formatTokens(value)} tokens` : t('{{count}} requests', { count: value });
  const peak = Math.max(...buckets.map(valueOf), 0);
  const scale = peak > 0 ? peak : 1;
  const slot = width / Math.max(buckets.length, 1);
  const barWidth = Math.min(MAX_BAR_WIDTH, Math.max(2, slot * 0.62));
  const ticks = tickIndexes(buckets.length);
  const hoveredBucket = hovered === null ? null : buckets[hovered];

  return (
    <section className="usage-card" aria-label={t('Usage trend')} data-testid="usage-trend">
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between', padding: '2px 2px 10px' }}>
        <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
          <strong style={{ color: 'var(--text-primary)', fontSize: 'var(--fs-label)', fontWeight: 'var(--fw-semibold)' }}>
            {t('Usage trend')}
          </strong>
          <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-caption)' }}>· {rangeLabel}</span>
          {/* 图例：与柱同色的色块 + 当前指标 */}
          <span data-testid="usage-trend-legend" style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            color: 'var(--text-secondary)', fontSize: 'var(--fs-caption)',
          }}>
            <span aria-hidden="true" style={{
              width: 9, height: 9, borderRadius: 2, background: 'var(--chart-bar)', flexShrink: 0,
            }} />
            {metric === 'tokens' ? t('Tokens') : t('Requests')}
          </span>
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

        <div ref={plotRef} style={{ flex: 1, minWidth: 0, position: 'relative' }}>
          {hoveredBucket && (
            <div data-testid="usage-trend-tooltip" className="workspace-floating" style={{
              position: 'absolute', zIndex: 2, pointerEvents: 'none',
              left: Math.min(Math.max(0, (hovered ?? 0) * slot + slot / 2 - 70), Math.max(0, width - 148)),
              top: -4, minWidth: 140, padding: '8px 10px',
              color: 'var(--text-primary)', fontSize: 'var(--fs-caption)', whiteSpace: 'nowrap',
            }}>
              <p style={{ margin: '0 0 4px', fontWeight: 'var(--fw-semibold)' }}>{bucketStamp(hoveredBucket.start)}</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontVariantNumeric: 'tabular-nums' }}>
                <span aria-hidden="true" style={{
                  width: 9, height: 9, borderRadius: 2, background: 'var(--chart-bar)', flexShrink: 0,
                }} />
                <span style={{ color: 'var(--text-secondary)' }}>{metric === 'tokens' ? t('Tokens') : t('Requests')}</span>
                <span style={{ marginLeft: 'auto', paddingLeft: 12 }}>{formatValue(valueOf(hoveredBucket))}</span>
              </div>
            </div>
          )}

          <svg data-testid="usage-trend-chart" role="img"
            aria-label={t('{{metric}} over time', { metric: metric === 'tokens' ? t('Tokens') : t('Requests') })}
            width={width} height={CHART_HEIGHT}
            viewBox={`0 0 ${width} ${CHART_HEIGHT}`} preserveAspectRatio="none"
            onMouseLeave={() => setHovered(null)}
            style={{ display: 'block', width: '100%', height: CHART_HEIGHT }}>
            {[0, 0.5, 1].map((fraction) => (
              <line key={fraction} x1={0} x2={width} y1={CHART_HEIGHT * fraction} y2={CHART_HEIGHT * fraction}
                stroke="var(--border)" strokeWidth={1} />
            ))}
            {buckets.map((bucket, index) => {
              const value = valueOf(bucket);
              const barHeight = value > 0 ? Math.max(2, (value / scale) * (CHART_HEIGHT - 2)) : 0;
              const left = index * slot + (slot - barWidth) / 2;
              return (
                <g key={bucket.start}>
                  {/* 悬停高亮整列（参考面板用 --bg-subtle，这里用同角色的 --hover） */}
                  {hovered === index && (
                    <rect x={index * slot} y={0} width={slot} height={CHART_HEIGHT} fill="var(--hover)" />
                  )}
                  {value > 0 && (
                    <rect data-testid="usage-trend-bar" x={left} y={CHART_HEIGHT - barHeight}
                      width={barWidth} height={barHeight} rx={BAR_RADIUS} fill="var(--chart-bar)">
                      <title>{`${bucketStamp(bucket.start)} · ${formatValue(value)}`}</title>
                    </rect>
                  )}
                  {/* 命中区：整列可悬停，空桶也能看到时间与 0 */}
                  <rect data-testid={`usage-trend-slot-${index}`} x={index * slot} y={0}
                    width={slot} height={CHART_HEIGHT} fill="transparent"
                    onMouseEnter={() => setHovered(index)} />
                </g>
              );
            })}
          </svg>

          <div style={{ position: 'relative', height: 14, marginTop: 4 }}>
            {ticks.map((index) => (
              <span key={index} style={{
                position: 'absolute', left: `${((index + 0.5) / Math.max(buckets.length, 1)) * 100}%`, transform: 'translateX(-50%)',
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
