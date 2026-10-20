import { t } from '@i18n';

export interface ResourceSample { time: number; value: number }
interface ChartSeries { label: string; samples: readonly ResourceSample[]; color: string }
export const RESOURCE_HISTORY_MS = 300_000;

/** Grow the visible time range in minutes while retaining the full history limit. */
export function resourceHistoryWindow(startTime: number | undefined, endTime: number): number {
  const elapsed = startTime != null && Number.isFinite(startTime) ? Math.max(0, endTime - startTime) : 0;
  return Math.min(RESOURCE_HISTORY_MS, Math.max(60_000, Math.ceil(elapsed / 60_000) * 60_000));
}

/** Actual timestamps preserve sampling intervals and leave interruptions empty. */
export function resourceTrendSegments(samples: readonly ResourceSample[], endTime: number, maximum = 100, windowMs = RESOURCE_HISTORY_MS): string[] {
  const recent = samples.filter(sample => Number.isFinite(sample.value) && sample.time >= endTime - windowMs && sample.time <= endTime);
  const segments: string[] = [];
  let points: string[] = [];
  recent.forEach((sample, index) => {
    if (index > 0 && sample.time - recent[index - 1].time > 45_000) {
      if (points.length > 1) segments.push(points.join(' '));
      points = [];
    }
    const x = 2 + (sample.time - endTime + windowMs) / windowMs * 276;
    const y = 74 - Math.max(0, Math.min(maximum, sample.value)) / maximum * 68;
    points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  });
  if (points.length > 1) segments.push(points.join(' '));
  return segments;
}

export default function SshResourceChart({ samples = [], series, endTime, label, caption = label, maximum = 100, maximumLabel = '100%', minimumLabel = '0%', windowMs }: { samples?: readonly ResourceSample[]; series?: readonly ChartSeries[]; endTime: number; label: string; caption?: string; maximum?: number; maximumLabel?: string; minimumLabel?: string; windowMs?: number }) {
  const source = series ?? [{ label, samples, color: 'var(--chart-blue)' }];
  const start = Math.min(...source.flatMap(line => line.samples.filter(sample => Number.isFinite(sample.value) && sample.time <= endTime).map(sample => sample.time)));
  const duration = windowMs ?? resourceHistoryWindow(Number.isFinite(start) ? start : undefined, endTime);
  const lines = source.map(line => ({ ...line, segments: resourceTrendSegments(line.samples, endTime, maximum, duration) }));
  const empty = lines.every(line => !line.segments.length);
  return <div className="ssh-resource-chart" data-window-ms={duration} data-end-time={endTime}>
    <div className="ssh-resource-chart-axis" aria-hidden="true"><span className="ssh-resource-chart-caption" data-tip={caption}>{caption}</span><span>{maximumLabel}</span></div>
    <div className="ssh-resource-chart-plot"><svg viewBox="0 0 280 80" preserveAspectRatio="none" role="img" aria-label={label}>
      <rect className="ssh-resource-chart-frame" x="2" y="6" width="276" height="68" fill="none" vectorEffect="non-scaling-stroke" />
      {[23, 40, 57].map(y => <line key={`y-${y}`} className="ssh-resource-chart-grid" x1="2" x2="278" y1={y} y2={y} vectorEffect="non-scaling-stroke" />)}
      {[36.5, 71, 105.5, 140, 174.5, 209, 243.5].map(x => <line key={`x-${x}`} className="ssh-resource-chart-grid" x1={x} x2={x} y1="6" y2="74" vectorEffect="non-scaling-stroke" />)}
      {lines.map(line => <g key={line.label} data-series={line.label} style={{ color: line.color }}>{line.segments.map((points, index) => {
        const positions = points.split(' ');
        return <g key={index}>
          <polygon className="ssh-resource-chart-area" points={`${positions[0].split(',')[0]},74 ${points} ${positions[positions.length - 1].split(',')[0]},74`} />
          <polyline points={points} fill="none" vectorEffect="non-scaling-stroke" />
        </g>;
      })}</g>)}
    </svg>
    {empty && <span className="ssh-resource-chart-empty">{t('Waiting for samples…')}</span>}
    </div>
    <div className="ssh-status-time-axis" aria-hidden="true"><span>{t('Last {{minutes}} min', { minutes: duration / 60_000 })}</span><span>{minimumLabel}</span></div>
  </div>;
}
