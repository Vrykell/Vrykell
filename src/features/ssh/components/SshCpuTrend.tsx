import { t } from '@i18n';

export interface CpuSample { time: number; value: number }

/** Leave gaps between readings when sampling was interrupted. */
export function cpuTrendSegments(samples: readonly CpuSample[]): string[] {
  if (!samples.length) return [];
  const first = samples[0].time;
  const duration = Math.max(1, samples[samples.length - 1].time - first);
  const segments: string[] = [];
  let points: string[] = [];
  for (let index = 0; index < samples.length; index++) {
    const sample = samples[index];
    if (index > 0 && sample.time - samples[index - 1].time > 45000) {
      segments.push(points.join(' '));
      points = [];
    }
    const x = samples.length === 1 ? 238 : 2 + (sample.time - first) / duration * 236;
    const y = 58 - Math.max(0, Math.min(100, sample.value)) / 100 * 54;
    points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  if (points.length) segments.push(points.join(' '));
  return segments;
}

export default function SshCpuTrend({ samples }: { samples: readonly CpuSample[] }) {
  if (!samples.length) return null;
  return <div className="ssh-status-cpu-history" data-tip={t('Recent CPU usage')}>
    <svg viewBox="0 0 240 62" role="img" aria-label={t('Recent CPU usage')}>
      {cpuTrendSegments(samples).map((points, index) => points.includes(' ')
        ? <polyline key={index} points={points} fill="none" vectorEffect="non-scaling-stroke" />
        : <circle key={index} cx={points.split(',')[0]} cy={points.split(',')[1]} r="2" />)}
    </svg>
  </div>;
}
