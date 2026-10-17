import { t } from '@i18n';
import { fmtSize } from '@ui/UiBtn';
import type { NetworkRateSample } from '../model/networkRates';
import SshResourceChart from './SshResourceChart';

export default function SshNetworkRates({ samples, now, available, windowMs }: { samples: readonly NetworkRateSample[]; now: number; available: boolean; windowMs?: number }) {
  const latest = samples[samples.length - 1];
  const series = (['download', 'upload'] as const).map(direction => ({
    direction, label: t(direction === 'download' ? 'Download' : 'Upload'),
    samples: samples.flatMap(sample => sample[direction] == null ? [] : [{ time: sample.time, value: sample[direction]! }]),
    color: direction === 'download' ? 'var(--chart-cyan)' : 'var(--chart-violet)',
  }));
  const maximum = Math.max(1024, 2 ** Math.ceil(Math.log2(Math.max(1, ...series.flatMap(line => line.samples.map(sample => sample.value))))));
  return <div className="ssh-network-rates" aria-label={t('Server network transfer')} data-tip={t('Combined traffic on the server’s non-loopback network interfaces.')}>
    <div className="ssh-network-rate-readings">{series.map(({ direction, label, color }) => {
      const current = latest?.[direction];
      return <div className="ssh-network-rate" key={direction}>
        <span><i style={{ background: color }} />{label}</span><strong>{current == null ? '—' : `${fmtSize(current)}/s`}</strong>
      </div>;
    })}</div>
    <SshResourceChart series={series} endTime={now} windowMs={windowMs} label={t('Upload and download history')} maximum={maximum} maximumLabel={`${fmtSize(maximum)}/s`} minimumLabel="0" />
    {latest && latest.download == null && latest.upload == null && <p className="ssh-status-caption">{t(available ? 'Transfer rates require two recent samples.' : 'Transfer rates are unavailable on this server.')}</p>}
  </div>;
}
