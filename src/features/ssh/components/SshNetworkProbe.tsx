import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { t } from '@i18n';
import ErrorBox from '@ui/feedback/ErrorBox';
import { TextButton } from '@ui/actions/TextButton';
import { sshNetworkProbe, type NetworkProbe } from '../services/api';
import { summarizeNetworkProbe } from '../model/networkProbe';

const statusLabels = { reachable: 'Reachable', partial: 'Intermittent connection', unreachable: 'Unreachable' } as const;
const failureLabels = { timeout: 'Connection timed out', refused: 'Port refused the connection', unreachable: 'Unreachable' } as const;
const milliseconds = (value: number | null) => value == null ? '—' : `${value.toFixed(1)} ms`;

export default function SshNetworkProbe({ host, port, jumpHost, paused = false, revision = 0, children }: { host: string; port: number; jumpHost?: string; paused?: boolean; revision?: number; children?: ReactNode }) {
  const [result, setResult] = useState<NetworkProbe | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const request = useRef(0);
  const pending = useRef<{ host: string; port: number; result: Promise<NetworkProbe> } | null>(null);
  useEffect(() => {
    request.current++; setResult(null); setError(''); setBusy(false);
    return () => { request.current++; };
  }, [host, port]);
  const probe = useCallback(async () => {
    const id = ++request.current;
    setBusy(true); setError('');
    try {
      // Reuse a pending check when effects restart before its native request completes.
      const current = pending.current?.host === host && pending.current.port === port ? pending.current
        : { host, port, result: sshNetworkProbe(host, port) };
      pending.current = current;
      const next = await current.result.finally(() => { if (pending.current === current) pending.current = null; });
      if (request.current === id) setResult(next);
    } catch (reason) {
      if (request.current === id) setError(String(reason instanceof Error ? reason.message : reason));
    } finally { if (request.current === id) setBusy(false); }
  }, [host, port]);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const collect = async () => {
      if (disposed || paused || !host) return;
      if (document.hidden) { timer = setTimeout(() => void collect(), 1000); return; }
      await probe();
      if (!disposed) timer = setTimeout(() => void collect(), 30_000);
    };
    setBusy(false);
    void collect();
    return () => { disposed = true; clearTimeout(timer); request.current++; };
  }, [host, probe, paused, revision, refresh]);
  const summary = result && summarizeNetworkProbe(result);
  return <section className="ssh-status-network" aria-label={t('Network connectivity')}>
    <div className="ssh-status-section-heading"><h3 data-tip={t('TCP connection checks from this computer. No SSH login is performed.')}>{t('Network connectivity')}</h3>
      <TextButton disabled={busy || !host || paused} onClick={() => setRefresh(value => value + 1)}>{t(busy ? 'Probing…' : result ? 'Probe again' : 'Start probe')}</TextButton>
    </div>
    {jumpHost && jumpHost.toLowerCase() !== 'none' && <p className="ssh-status-caption ssh-network-note">{t('Tests the direct route to the target, without the jump host.')}</p>}
    {error && <div className="ssh-network-error"><ErrorBox title={t('Network probe failed')} details={error}>{t('Check the server address, network and firewall, then try again.')}</ErrorBox></div>}
    {children}
    {summary && result && <div className="ssh-network-result" data-testid="ssh-network-result" data-connectivity={summary.status} data-stale={!!error || paused || busy} aria-busy={busy}>
      {error && <p className="ssh-status-caption">{t('Previous probe result')}</p>}
      <div className="ssh-network-result-heading"><strong role="status">{t(statusLabels[summary.status])}</strong><span data-tip={result.attempts.map((attempt, index) => `${index + 1} · ${attempt.latencyMs == null ? t(failureLabels[attempt.errorKind ?? 'unreachable']) : milliseconds(attempt.latencyMs)}`).join('\n')}>{t('{{success}}/{{total}} succeeded', { success: summary.succeeded, total: summary.total })}</span></div>
      <dl className="ssh-status-facts">
        <div className="ssh-status-row"><dt>{t('Connection success rate')}</dt><dd>{summary.successRate}%</dd></div>
        <div className="ssh-status-row"><dt>{t('Average TCP connect time')}</dt><dd>{milliseconds(summary.average)}</dd></div>
        {summary.minimum != null && <div className="ssh-status-row"><dt>{t('Fastest / slowest')}</dt><dd>{milliseconds(summary.minimum)} / {milliseconds(summary.maximum)}</dd></div>}
        <div className="ssh-status-row"><dt>{t('Address resolution')}</dt><dd>{milliseconds(result.dnsMs)}</dd></div>
      </dl>
    </div>}
  </section>;
}
