import { t } from '@i18n';

export interface ResourceSample { time: number; value: number }
interface ChartSeries { label: string; samples: readonly ResourceSample[]; color: string }
export const RESOURCE_HISTORY_MS = 300_000;

/** A fixed five-minute time axis keeps short histories and interrupted sampling honest. */
export function resourceTrendSegments(samples: readonly ResourceSample[], endTime: number, maximum = 100): string[] {
  const recent = samples.filter(sample => Number.isFinite(sample.value) && sample.time >= endTime - RESOURCE_HISTORY_MS && sample.time <= endTime);
  const segments: string[] = [];
  let points: string[] = [];
  recent.forEach((sample, index) => {
    if (index > 0 && sample.time - recent[index - 1].time > 45_000) {
      segments.push(points.join(' '));
      points = [];
    }
    const x = 2 + (sample.time - endTime + RESOURCE_HISTORY_MS) / RESOURCE_HISTORY_MS * 276;
    const y = 74 - Math.max(0, Math.min(maximum, sample.value)) / maximum * 68;
    points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  });
  if (points.length) segments.push(points.join(' '));
  return segments;
}

export default function SshResourceChart({ samples = [], series, endTime, label, maximum = 100, maximumLabel = '100%', minimumLabel = '0%' }: { samples?: readonly ResourceSample[]; series?: readonly ChartSeries[]; endTime: number; label: string; maximum?: number; maximumLabel?: string; minimumLabel?: string }) {
  const lines = (series ?? [{ label, samples, color: 'var(--chart-accent, var(--resource-accent))' }])
    .map(line => ({ ...line, segments: resourceTrendSegments(line.samples, endTime, maximum) }));
  const empty = lines.every(line => !line.segments.length);
  return <div className="ssh-resource-chart">
    <svg viewBox="0 0 280 80" preserveAspectRatio="none" role="img" aria-label={label}>
      {[6, 40, 74].map(y => <line key={y} className="ssh-resource-chart-grid" x1="2" x2="278" y1={y} y2={y} vectorEffect="non-scaling-stroke" />)}
      {lines.map(line => <g key={line.label} data-series={line.label} style={{ color: line.color }}>{line.segments.map((points, index) => {
        const positions = points.split(' ');
        return positions.length > 1 ? <g key={index}>
          <polygon className="ssh-resource-chart-area" points={`${positions[0].split(',')[0]},74 ${points} ${positions[positions.length - 1].split(',')[0]},74`} />
          <polyline points={points} fill="none" vectorEffect="non-scaling-stroke" />
        </g> : <circle key={index} cx={positions[0].split(',')[0]} cy={positions[0].split(',')[1]} r="2.5" />;
      })}</g>)}
    </svg>
    <div className="ssh-resource-chart-axis" aria-hidden="true"><span>{maximumLabel}</span><span>{minimumLabel}</span></div>
    {empty && <span className="ssh-resource-chart-empty">{t('Waiting for samples…')}</span>}
  </div>;
}
