import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { SshOptions, SshSessionStatus } from '@core/ssh';
import { t } from '@i18n';
import { ChevronRight, Copy, RefreshCw, X, iconSizes } from '@ui/icons';
import { IconBtn, fmtSize } from '@ui/UiBtn';
import { TextButton } from '@ui/TextButton';
import ErrorBox from '@ui/ErrorBox';
import ResizeHandle from '@ui/ResizeHandle';
import Select from '@ui/Select';
import { writeClipboardText } from '@platform/clipboard';
import { useToastStore } from '@ui/Toast';
import { hideSshStatus, showSshStatus, useSshStatusDismissRequest } from '@features/workspace/hooks/useAuxiliarySidebar';
import { sshSystemStatus, type SshSystemStatus } from '../services/api';
import { isSshAuthenticationFailure } from '../model/fileServiceState';
import SshResourceChart, { RESOURCE_HISTORY_MS, type ResourceSample } from './SshResourceChart';
import SshNetworkProbe from './SshNetworkProbe';
import SshNetworkRates from './SshNetworkRates';
import { networkRates, type NetworkRateSample } from '../model/networkRates';
import { useResourceDisplay, type ResourceDisplay } from '../stores/resourceDisplay';
import './SshStatusPanel.css';
import { forgetSshAuthentication, requestSshAuthentication, useHasTemporarySshAuthentication, useSshAuthenticationRevision } from '../hooks/useSessionAuthentication';

type Target = SshOptions & { name: string; host: string; user?: string; port?: number; connectionId?: string };
function StatusPlacement({ children }: { children: ReactNode }) {
  const host = document.getElementById('ssh-status-sidebar-host');
  return host ? createPortal(children, host) : children;
}
const phaseLabels = { connecting: 'Connecting…', connected: 'Connected', interactive: 'SSH interactive session', authenticating: 'Authenticating…', disconnected: 'Disconnected', unavailable: 'Connection unavailable' } as const;
/** Status width bounds. Dragging to the minimum folds the panel; releasing there closes it. */
const MIN_STATUS_WIDTH = 240;
/** Ceiling used only while the workspace geometry cannot be measured; real drags stop where the terminal hits its minimum width. */
const FALLBACK_STATUS_MAX = 560;

export function statusDuration(seconds: number): string {
  const value = Math.max(0, Math.floor(seconds));
  if (value >= 86400) return t('{{d}}d {{h}}h', { d: Math.floor(value / 86400), h: Math.floor(value % 86400 / 3600) });
  if (value >= 3600) return t('{{h}}h {{m}}m', { h: Math.floor(value / 3600), m: Math.floor(value % 3600 / 60) });
  return t('{{m}}m {{s}}s', { m: Math.floor(value / 60), s: value % 60 });
}

export function cpuUsage(previous: SshSystemStatus | null, current: SshSystemStatus): number | null {
  if (previous?.cpuTotal == null || previous.cpuIdle == null || current.cpuTotal == null || current.cpuIdle == null) return null;
  const total = current.cpuTotal - previous.cpuTotal;
  const idle = current.cpuIdle - previous.cpuIdle;
  return total > 0 && idle >= 0 && idle <= total ? 100 * (total - idle) / total : null;
}

function Metric({ resource = 'cpu', label, used, total, percentage, history, hint, display, now }: { resource?: 'cpu' | 'memory' | 'disk'; label: string; used?: number | null; total?: number | null; percentage?: number | null; history: readonly ResourceSample[]; hint?: ReactNode; display: ResourceDisplay; now: number }) {
  const percent = percentage !== undefined ? percentage : used != null && total != null && total > 0 ? used / total * 100 : null;
  const reading = used != null && total != null ? `${fmtSize(used)} / ${fmtSize(total)}` : null;
  return <div className="ssh-status-metric" data-display={display} data-resource={resource}>
    <div className="ssh-status-metric-head">
      <span className="ssh-status-metric-label">{label}</span>
      <strong className="ssh-status-metric-value" data-empty={percent == null || undefined}>{percent == null ? t('Unavailable') : <>{Math.round(percent)}<small>%</small></>}</strong>
    </div>
    {reading && <span className="ssh-status-caption ssh-status-metric-caption">{reading}</span>}
    {display === 'chart' ? <SshResourceChart samples={history} endTime={now} label={t('{{resource}} history', { resource: label })} />
      : <div className="ssh-status-meter" data-empty={percent == null || undefined} role={percent == null ? undefined : 'meter'} aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent == null ? undefined : Math.round(percent)}>
      <i data-level={percent == null ? 'unknown' : percent >= 90 ? 'critical' : percent >= 80 ? 'warning' : 'normal'} style={{ width: `${Math.max(0, Math.min(100, percent ?? 0))}%` }} />
    </div>}
    {hint}
  </div>;
}

export default function SshStatusPanel({ paneId, target, state, active, focused = true, onReconnect, width = 300, onWidthChange, onToolbarReady, compact = false, statusTrigger, openRequest = 0, toggleRequest = 0, onOpenChange, children }: { paneId?: string; target: Target; state: SshSessionStatus; active: boolean; focused?: boolean; onReconnect?: () => Promise<void>; width?: number; onWidthChange?: (width: number) => void; onToolbarReady?: (host: HTMLDivElement | null) => void; compact?: boolean; statusTrigger?: HTMLButtonElement | null; openRequest?: number; toggleRequest?: number; onOpenChange?: (open: boolean) => void; children?: ReactNode }) {
  const authenticationRevision = useSshAuthenticationRevision(target.connectionId);
  const temporaryAuthentication = useHasTemporarySshAuthentication(target.connectionId);
  const [open, setOpen] = useState(false);
  const fallbackId = useId();
  const sidebarOwner = paneId ?? fallbackId;
  const displayOpen = open && active && focused;
  useEffect(() => { onOpenChange?.(displayOpen); }, [displayOpen, onOpenChange]);
  useEffect(() => {
    if (!displayOpen) return;
    showSshStatus(sidebarOwner);
    return () => hideSshStatus(sidebarOwner);
  }, [displayOpen, sidebarOwner]);
  const dismissRequest = useSshStatusDismissRequest();
  const seenDismissRequest = useRef(dismissRequest);
  useEffect(() => {
    if (dismissRequest === seenDismissRequest.current) return;
    seenDismissRequest.current = dismissRequest;
    if (displayOpen) setOpen(false);
  }, [dismissRequest, displayOpen]);
  const [paused, setPaused] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [sample, setSample] = useState<SshSystemStatus | null>(null);
  const [cpu, setCpu] = useState<number | null>(null);
  const [cpuHistory, setCpuHistory] = useState<ResourceSample[]>([]);
  const [memoryHistory, setMemoryHistory] = useState<ResourceSample[]>([]);
  const [diskHistory, setDiskHistory] = useState<ResourceSample[]>([]);
  const [trafficHistory, setTrafficHistory] = useState<NetworkRateSample[]>([]);
  const display = useResourceDisplay(value => value.display);
  const setDisplay = useResourceDisplay(value => value.setDisplay);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [sampleValid, setSampleValid] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [now, setNow] = useState(Date.now);
  const [connectedAt, setConnectedAt] = useState<number | null>(null);
  const previous = useRef<SshSystemStatus | null>(null);
  const trafficPrevious = useRef<{ sample: SshSystemStatus; time: number } | null>(null);
  const inFlight = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const [folded, setFolded] = useState(false);
  const [maxWidth, setMaxWidth] = useState(FALLBACK_STATUS_MAX);
  const [liveWidth, setLiveWidth] = useState(width);
  const widthRef = useRef(width);
  const committedWidth = useRef(width);
  const dragPaneWidth = useRef<number | null>(null);
  const dragMaximum = useRef(FALLBACK_STATUS_MAX);
  useEffect(() => { widthRef.current = width; setLiveWidth(width); }, [width]);
  useEffect(() => { if (openRequest > 0) setOpen(true); }, [openRequest]);
  useEffect(() => { if (toggleRequest > 0) setOpen(value => !value); }, [toggleRequest]);
  const connected = (state.phase === 'connected' || state.phase === 'interactive') && !state.retrying;
  const address = `${target.user ? `${target.user}@` : ''}${target.host}:${target.port ?? 22}`;
  const unsupported = !target.connectionId ? t('Save this connection to monitor remote resources.') : target.jumpHost && target.jumpHost.toLowerCase() !== 'none' ? t('Resource monitoring is unavailable for jump hosts.') : null;

  useEffect(() => {
    const time = Date.now();
    setConnectedAt(connected ? time : null);
    setSampleValid(false);
    previous.current = null;
    trafficPrevious.current = null;
  }, [state.phase, connected]);

  useEffect(() => {
    setSample(null); setCpu(null); setUpdatedAt(null); setSampleValid(false);
    setCpuHistory([]); setMemoryHistory([]); setDiskHistory([]); previous.current = null;
    setTrafficHistory([]); trafficPrevious.current = null;
  }, [target.connectionId, target.host, target.port, target.user]);

  // Follow the newest log line; the box keeps a bounded history.
  useEffect(() => { const element = logRef.current; if (element) element.scrollTop = element.scrollHeight; }, [state.log.length]);

  useEffect(() => {
    if (!displayOpen) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [displayOpen]);

  useEffect(() => {
    if (!displayOpen || !connected || paused || unsupported || !target.connectionId) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const collect = async () => {
      if (document.hidden || inFlight.current) { timer = setTimeout(() => void collect(), 1000); return; }
      inFlight.current = true;
      setBusy(true);
      let nextDelay = 15000;
      let retryAllowed = true;
      try {
        const result = await sshSystemStatus(target.connectionId!, target.host, target.port ?? 22, target.user ?? '');
        if (!disposed) {
          const usage = cpuUsage(previous.current, result);
          const time = Date.now();
          const rates = networkRates(trafficPrevious.current, result, time);
          trafficPrevious.current = { sample: result, time };
          setTrafficHistory(values => [...values.filter(value => time - value.time <= RESOURCE_HISTORY_MS), rates].slice(-21));
          setCpu(usage); previous.current = result;
          setSample(result); setSampleValid(true); setUpdatedAt(time); setNow(time); setError('');
          setCpuHistory(values => {
            const recent = values.filter(value => time - value.time <= RESOURCE_HISTORY_MS);
            return usage == null ? recent : [...recent, { time, value: usage }].slice(-21);
          });
          const pushPercent = (setter: typeof setCpuHistory, used: number | null | undefined, total: number | null | undefined) => {
            setter(values => {
              const recent = values.filter(value => time - value.time <= RESOURCE_HISTORY_MS);
              const percent = used != null && total != null && total > 0 ? used / total * 100 : null;
              return percent == null ? recent : [...recent, { time, value: percent }].slice(-21);
            });
          };
          pushPercent(setMemoryHistory, result.memoryTotal != null && result.memoryAvailable != null ? result.memoryTotal - result.memoryAvailable : null, result.memoryTotal);
          pushPercent(setDiskHistory, result.diskUsed, result.diskTotal);
        }
      } catch (reason) { if (!disposed) { setError(String(reason)); nextDelay = 30000; retryAllowed = !isSshAuthenticationFailure(String(reason)); } }
      finally {
        inFlight.current = false;
        setBusy(false);
        if (!disposed && retryAllowed) { timer = setTimeout(() => void collect(), nextDelay); }
      }
    };
    void collect();
    return () => { disposed = true; clearTimeout(timer); };
  }, [displayOpen, connected, paused, unsupported, target.connectionId, target.host, target.port, target.user, refresh, authenticationRevision]);

  const close = () => { setOpen(false); (statusTrigger ?? trigger.current)?.focus(); };
  // The live width stays local: publishing it per drag frame would re-render the terminal pane subtree and make the drag jitter.
  const applyWidth = (next: number) => { widthRef.current = next; setLiveWidth(next); };
  const publishWidth = (next: number) => onWidthChange?.(next);
  const workspaceTerminalMin = () => {
    const body = document.querySelector<HTMLElement>('.workspace-body');
    const value = Number.parseFloat(body ? getComputedStyle(body).getPropertyValue('--workspace-terminal-min-width') : '');
    return Number.isFinite(value) ? Math.max(360, value) : 360;
  };
  /** Grow until the workspace terminal reaches its minimum width, like every other side panel. */
  const maximumWidth = (paneWidth: number) => paneWidth <= 0 ? FALLBACK_STATUS_MAX : Math.max(MIN_STATUS_WIDTH, Math.round(paneWidth - workspaceTerminalMin()));
  /** Terminal and panel share one width budget; the terminal measurement plus the panel width recovers it. */
  const paneWidthAt = () => {
    const workspaceWidth = document.querySelector<HTMLElement>('.workspace-main')?.getBoundingClientRect().width;
    return workspaceWidth != null ? workspaceWidth + widthRef.current : frameRef.current?.closest('.terminal-pane')?.getBoundingClientRect().width ?? 0;
  };
  const dragStep = (delta: number) => {
    const next = Math.round(widthRef.current - delta);
    // Reaching the minimum folds the panel: it stays mounted and hidden, so dragging back out before release restores it.
    if (next <= MIN_STATUS_WIDTH) { applyWidth(MIN_STATUS_WIDTH); setFolded(true); return; }
    applyWidth(Math.min(dragMaximum.current, next));
    setFolded(false);
  };
  const resize = (delta: number) => {
    if (dragPaneWidth.current == null) {
      // Start from the rendered width: the window may have clamped the panel since the last drag.
      const measured = frameRef.current?.getBoundingClientRect().width;
      if (measured) widthRef.current = Math.round(measured);
      dragPaneWidth.current = paneWidthAt();
      // Measure the limit once per drag; reading computed styles on every move forces a style flush.
      dragMaximum.current = maximumWidth(dragPaneWidth.current);
      setMaxWidth(dragMaximum.current);
    }
    dragStep(delta);
  };
  const commitResize = () => {
    dragPaneWidth.current = null;
    if (widthRef.current <= MIN_STATUS_WIDTH) {
      // Released at the minimum: close the panel, keep the last stable width for the next open and return focus to the entry.
      const restore = committedWidth.current;
      applyWidth(restore);
      publishWidth(restore);
      setFolded(false);
      setOpen(false);
      (statusTrigger ?? trigger.current)?.focus();
      return;
    }
    committedWidth.current = widthRef.current;
    publishWidth(widthRef.current);
    setFolded(false);
  };
  const nudgeWidth = (step: number) => {
    const maximum = maximumWidth(paneWidthAt());
    setMaxWidth(maximum);
    const next = Math.max(MIN_STATUS_WIDTH, Math.min(maximum, widthRef.current + step));
    applyWidth(next);
    committedWidth.current = next;
    publishWidth(next);
  };
  const stale = !sampleValid || !connected || !!error || paused || (updatedAt != null && now - updatedAt > 30000);
  const authenticationFailed = isSshAuthenticationFailure(error);
  return <div className="ssh-status-shell" data-open={displayOpen} data-active={active} data-compact={compact}>
    {!compact && <div className="ssh-status-toolbar" onMouseDown={event => event.stopPropagation()} onContextMenu={event => event.stopPropagation()}>
      <div className="ssh-session-toolbar-slot" ref={onToolbarReady}>
        {(!onToolbarReady || !statusTrigger || state.phase === 'unavailable') && <TextButton ref={trigger} className="ssh-session-status" data-testid="ssh-status-toggle" aria-label={t('SSH status')} data-tip={t(displayOpen ? 'Close SSH status' : 'Open SSH status')} aria-expanded={displayOpen} aria-controls={panelId} onClick={() => setOpen(value => !value)}>
          <i className="ssh-status-dot" data-phase={state.phase} /><span role="status">{t(phaseLabels[state.phase])}</span>
        </TextButton>}
      </div>
    </div>}
    <div className="ssh-status-body">
      {children}
      {displayOpen && <StatusPlacement><div ref={frameRef} className="ssh-status-frame" data-folded={folded || undefined} style={{ width: folded ? 0 : liveWidth }} onMouseDown={event => event.stopPropagation()} onContextMenu={event => event.stopPropagation()}>
      {onWidthChange && <div role="separator" aria-label={t('Resize SSH status')} aria-orientation="vertical" aria-valuemin={MIN_STATUS_WIDTH} aria-valuemax={maxWidth} aria-valuenow={liveWidth} tabIndex={0} className="ssh-status-resize" onKeyDown={event => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); nudgeWidth(event.key === 'ArrowLeft' ? 16 : -16); }
        if (event.key === 'Escape') { event.stopPropagation(); close(); }
      }}><ResizeHandle axis="x" edge="left" onDelta={resize} onUp={commitResize} testId="ssh-status-resize-handle" /></div>}
      <aside id={panelId} aria-label={t('SSH status')} data-testid="ssh-status-panel" className="ssh-status-panel" style={{ display: folded ? 'none' : undefined }} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); close(); } }}>
        <div className="ssh-status-scroll scroll-region">
          <header><strong>{t('Remote resources')}</strong><div className="ssh-status-header-actions">
            <IconBtn title={t('Refresh remote resources')} disabled={!connected || !!unsupported || busy} onClick={() => { setPaused(false); setRefresh(value => value + 1); }}><RefreshCw size={iconSizes.compact} /></IconBtn>
            <IconBtn title={t('Close SSH status')} onClick={close}><X size={iconSizes.control} /></IconBtn>
          </div></header>
          <section className="ssh-status-overview">
            <div className="ssh-status-identity-row"><div className="ssh-status-identity">{target.name || target.host}</div><span className="ssh-status-phase" data-tip={t('Connection status')}><i className="ssh-status-dot" data-phase={state.phase} />{state.retrying ? t('Reconnecting…') : t(phaseLabels[state.phase])}</span></div>
            <div className="ssh-status-address"><span data-tip={address}>{address}</span><IconBtn title={t('Copy connection address')} onClick={() => { void writeClipboardText(address).catch(reason => useToastStore.getState().addToast(String(reason), 'error')); }}><Copy size={iconSizes.compact} /></IconBtn></div>
            {onReconnect && (state.phase === 'disconnected' || state.retrying) && <TextButton className="ssh-status-reconnect" disabled={reconnecting} onClick={() => {
              setReconnecting(true);
              void onReconnect().catch(reason => useToastStore.getState().addToast(String(reason), 'error')).finally(() => setReconnecting(false));
            }}>{t('Reconnect SSH session')}</TextButton>}
          </section>
          <SshNetworkProbe host={target.host} port={target.port ?? 22} jumpHost={target.jumpHost} paused={paused} revision={refresh}>
            {sample && <SshNetworkRates samples={trafficHistory} now={now} display={display} available={sample.networkReceived != null || sample.networkTransmitted != null} />}
          </SshNetworkProbe>
          <section className="ssh-status-resource">
            <div className="ssh-status-section-heading"><h3>{t('Resource usage')}</h3>
              <Select aria-label={t('Resource display')} value={display} onChange={setDisplay} options={[
                { value: 'bars', label: t('Progress bars') }, { value: 'chart', label: t('Charts') },
              ]} />
            </div>
            {unsupported ? <div className="ssh-status-state"><ErrorBox tone="info">{unsupported}</ErrorBox></div> : <>
              {(error || !sample) && <div className="ssh-status-state">
                {error && <ErrorBox style={{ overflowWrap: 'anywhere' }} title={t(authenticationFailed ? 'Saved SSH authentication failed' : 'Resource collection failed')} details={error} detailsTitle={t('Technical details')} actions={authenticationFailed && target.connectionId ? <button style={{ minHeight: 36 }} onClick={() => requestSshAuthentication({ ...target, connectionId: target.connectionId! })}>{t('Authenticate services')}</button> : undefined}>{t(authenticationFailed ? 'Authenticate these services with the working server password or private key passphrase. The terminal session stays connected.' : 'The terminal connection is independent of resource monitoring.')}</ErrorBox>}
                {!sample && <p className="ssh-status-caption">{!connected ? t('Resources are collected after connecting.') : busy ? t('Collecting remote resources…') : t('No resource sample yet.')}</p>}
              </div>}
              {sample && <div className="ssh-status-sample" data-stale={stale}>
                <div className="ssh-status-metrics">
                  <Metric label={t('CPU usage')} percentage={cpu} history={cpuHistory} display={display} now={now} hint={cpu == null && sample.cpuTotal != null ? <p className="ssh-status-caption ssh-status-metric-hint">{t('CPU usage requires two samples.')}</p> : undefined} />
                  <Metric resource="memory" label={t('Memory usage')} used={sample.memoryTotal != null && sample.memoryAvailable != null ? sample.memoryTotal - sample.memoryAvailable : null} total={sample.memoryTotal} history={memoryHistory} display={display} now={now} />
                  <Metric resource="disk" label={t('Root disk usage')} used={sample.diskUsed} total={sample.diskTotal} history={diskHistory} display={display} now={now} />
                  {display === 'chart' && <div className="ssh-status-time-axis" aria-hidden="true"><span>{t('5 min ago')}</span><span>{t('Now')}</span></div>}
                </div>
                <details className="ssh-status-system-section ssh-status-details">
                  <summary>{t('System information')}<ChevronRight size={iconSizes.compact} /></summary>
                  <div className="ssh-status-system-body">
                  <div className="ssh-status-system"><strong>{sample.hostname || t('Unavailable')}</strong><span>{sample.system || t('Unavailable')}</span></div>
                  <dl className="ssh-status-facts">
                    <div className="ssh-status-row"><dt>{t('System uptime')}</dt><dd>{sample.uptimeSeconds == null ? t('Unavailable') : statusDuration(sample.uptimeSeconds)}</dd></div>
                    <div className="ssh-status-row ssh-status-load"><dt>{t('System load')}</dt><dd>
                      {sample.load.trim().split(/\s+/).length === 3 ? sample.load.trim().split(/\s+/).map((value, index) => <span key={index}><strong>{value}</strong><small>{t('{{minutes}} min', { minutes: [1, 5, 15][index] })}</small></span>) : sample.load || t('Unavailable')}
                    </dd></div>
                  </dl>
                  </div>
                </details>
              </div>}
            </>}
          </section>
          <section className="ssh-status-groups">
            <details className="ssh-status-details ssh-status-connection">
              <summary>{t('Connection details')}<ChevronRight size={iconSizes.compact} /></summary>
              <dl className="ssh-status-facts">
                <div className="ssh-status-row"><dt>{state.phase === 'interactive' ? t('Session duration') : t('Connected for')}</dt><dd>{connectedAt == null ? '—' : statusDuration((now - connectedAt) / 1000)}</dd></div>
                <div className="ssh-status-row"><dt>{t('Reconnect attempts')}</dt><dd>{state.reconnectAttempt}</dd></div>
                {sample && <div className="ssh-status-row" data-tip={t('Measured on a separate SSH connection.')}><dt>{t('Probe latency')}</dt><dd>{sample.latencyMs} ms</dd></div>}
              </dl>
            </details>
            <details className="ssh-status-details ssh-status-history">
              <summary>{t('Connection log')}<ChevronRight size={iconSizes.compact} /></summary>
              <div className="ssh-status-details-body">
                <div className="ssh-status-log scroll-region" ref={logRef}>
                  {state.log.length === 0
                    ? <p className="ssh-status-caption">{t('No connection output yet.')}</p>
                    : <ol className="ssh-status-events">{state.log.map((entry, index) => <li key={`${entry.time}-${index}`}><time>{new Date(entry.time).toLocaleTimeString()}</time><span>{entry.text}</span></li>)}</ol>}
                </div>
              </div>
            </details>
          </section>
        </div>
        <footer className="ssh-status-controls">
          <div className="ssh-status-controls-actions">
            <TextButton disabled={!target.host} onClick={() => setPaused(value => !value)}>{paused ? t('Resume monitoring') : t('Pause monitoring')}</TextButton>
            {temporaryAuthentication && target.connectionId && <TextButton onClick={() => { void forgetSshAuthentication(target.connectionId!).catch(reason => useToastStore.getState().addToast(String(reason), 'error')); }}>{t('Clear temporary credentials')}</TextButton>}
          </div>
          <div>
            {updatedAt && <p className="ssh-status-caption">{stale ? t('Last sample') : t('Updated')} · {t('{{seconds}}s ago', { seconds: Math.max(0, Math.floor((now - updatedAt) / 1000)) })}</p>}
            {paused && <p className="ssh-status-caption">{t('Monitoring paused')}</p>}
          </div>
        </footer>
      </aside></div></StatusPlacement>}
    </div>
  </div>;
}
