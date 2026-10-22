import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { t } from '@i18n';
import Select from '@ui/Select';
import CheckboxMenu from '@ui/CheckboxMenu';
import { IconBtn, fmtSize } from '@ui/UiBtn';
import SidebarToolbar from '@ui/SidebarToolbar';
import { ArrowSort, Columns2, DataUsage, Grid, RefreshCw, Settings, iconSizes } from '@ui/icons';
import { SshIcon } from '@ui/shellIcons';
import { iconColorCss, iconColorKey, useIconColorStore } from '@config/iconColors';
import { safeJsonParse, safeLocalStorageGet, safeLocalStorageSet } from '@utils/errorHandler';
import { ensureSshLoaded, useSshStore } from '../stores/store';
import { sshSystemStatus, type SshConnection, type SshSystemStatus } from '../services/api';
import { statusDuration } from './SshStatusPanel';
import './SshDashboard.css';

type MetricId = 'status' | 'cpu' | 'memory' | 'disk' | 'network' | 'load' | 'uptime';
type Layout = 'cards' | 'table';
type Sort = 'status' | 'name' | 'recent';
interface DashboardHostState {
  data?: SshSystemStatus;
  error?: string;
  busy?: boolean;
  cpu?: number | null;
  download?: number | null;
  upload?: number | null;
  updatedAt?: number;
}

const METRIC_IDS: MetricId[] = ['status', 'cpu', 'memory', 'disk', 'network', 'load', 'uptime'];
const METRIC_LABELS: Record<MetricId, string> = {
  status: 'Status', cpu: 'CPU', memory: 'Memory', disk: 'Disk', network: 'Network', load: 'Load', uptime: 'Uptime',
};
const DEFAULT_METRICS = Object.fromEntries(METRIC_IDS.map(id => [id, true])) as Record<MetricId, boolean>;
const PREFERENCES_KEY = 'vrykell-ssh-dashboard-v1';

function readPreferences(): { metrics: Record<MetricId, boolean>; layout: Layout; sort: Sort } {
  const saved = safeJsonParse<Record<string, unknown>>(safeLocalStorageGet(PREFERENCES_KEY) ?? '{}');
  const metrics = { ...DEFAULT_METRICS };
  if (saved?.metrics && typeof saved.metrics === 'object') {
    for (const id of METRIC_IDS) metrics[id] = (saved.metrics as Record<string, unknown>)[id] !== false;
  }
  return {
    metrics,
    layout: saved?.layout === 'table' ? 'table' : 'cards',
    sort: saved?.sort === 'name' ? 'name' : saved?.sort === 'recent' ? 'recent' : 'status',
  };
}

const percent = (used?: number | null, total?: number | null) => used != null && total != null && total > 0 ? Math.round(used / total * 100) : null;
const rate = (value?: number | null) => value == null ? null : `${value < 1024 ? value.toFixed(0) : (value / 1024).toFixed(1)} ${value < 1024 ? 'B/s' : 'KB/s'}`;

function metricSummary(sample: SshSystemStatus | undefined, state: DashboardHostState): string {
  if (state.error) return state.error;
  if (!sample) return t(state.busy ? 'Collecting remote resources…' : 'No resource sample yet.');
  return sample.system || t('Online');
}

/** The host workspace is an overview first; detailed management remains one explicit step away. */
export default function SshDashboard({ active = true, onManage, onOpenTerminal }: {
  active?: boolean;
  onManage: () => void;
  onOpenTerminal: (connection: SshConnection) => void;
}) {
  const connections = useSshStore(state => state.connections);
  const loaded = useSshStore(state => state.loaded);
  const iconColors = useIconColorStore(state => state.colors);
  const initial = useMemo(readPreferences, []);
  const [metrics, setMetrics] = useState(initial.metrics);
  const [layout, setLayout] = useState<Layout>(initial.layout);
  const [sort, setSort] = useState<Sort>(initial.sort);
  const [query, setQuery] = useState('');
  const [samples, setSamples] = useState<Record<string, DashboardHostState>>({});
  const [selected, setSelected] = useState<SshConnection | null>(null);
  const [metricMenu, setMetricMenu] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const metricTrigger = useRef<HTMLButtonElement>(null);
  const samplesRef = useRef<Record<string, DashboardHostState>>({});
  const selectedMetrics = METRIC_IDS.filter(id => metrics[id]).length;

  useEffect(() => { ensureSshLoaded(); }, []);
  useEffect(() => {
    safeLocalStorageSet(PREFERENCES_KEY, JSON.stringify({ metrics, layout, sort }));
  }, [metrics, layout, sort]);

  useEffect(() => {
    if (!active || !loaded || selectedMetrics === 0 || connections.length === 0) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const collect = async () => {
      if (document.hidden) {
        timer = setTimeout(() => void collect(), 1000);
        return;
      }
      const next = { ...samplesRef.current };
      for (const connection of connections) next[connection.id] = { ...next[connection.id], busy: true, error: undefined };
      if (!disposed) setSamples({ ...next });
      for (let index = 0; index < connections.length; index += 3) {
        await Promise.all(connections.slice(index, index + 3).map(async connection => {
          const previous = samplesRef.current[connection.id];
          const now = Date.now();
          try {
            const data = await sshSystemStatus(connection.id, connection.host, connection.port ?? 22, connection.user, {
              status: metrics.status, cpu: metrics.cpu, memory: metrics.memory, disk: metrics.disk,
              network: metrics.network, load: metrics.load, uptime: metrics.uptime,
            });
            const previousData = previous?.data;
            const cpu = previousData?.cpuTotal != null && previousData.cpuIdle != null && data.cpuTotal != null && data.cpuIdle != null
              ? (() => {
                const total = data.cpuTotal - previousData.cpuTotal!;
                const idle = data.cpuIdle - previousData.cpuIdle!;
                return total > 0 && idle >= 0 && idle <= total ? Math.round(100 * (total - idle) / total) : null;
              })() : null;
            const elapsed = previous?.updatedAt ? Math.max(0.1, (now - previous.updatedAt) / 1000) : 1;
            const download = previousData?.networkReceived != null && data.networkReceived != null
              ? Math.max(0, (data.networkReceived - previousData.networkReceived) / elapsed) : null;
            const upload = previousData?.networkTransmitted != null && data.networkTransmitted != null
              ? Math.max(0, (data.networkTransmitted - previousData.networkTransmitted) / elapsed) : null;
            next[connection.id] = { data, cpu, download, upload, updatedAt: now, busy: false };
          } catch (error) {
            next[connection.id] = { ...previous, busy: false, error: String((error as Error)?.message ?? error) };
          }
        }));
        if (disposed) return;
        samplesRef.current = { ...next };
        setSamples({ ...next });
      }
      timer = setTimeout(() => void collect(), 10_000);
    };
    void collect();
    return () => { disposed = true; if (timer) clearTimeout(timer); };
  }, [active, connections, loaded, metrics, refresh, selectedMetrics]);

  const visible = useMemo(() => {
    const value = query.trim().toLowerCase();
    const filtered = value ? connections.filter(connection => [connection.name, connection.host, connection.user].some(part => part.toLowerCase().includes(value))) : [...connections];
    return filtered.sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name)
      : sort === 'recent' ? (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0)
        : Number(Boolean(samples[a.id]?.data)) === Number(Boolean(samples[b.id]?.data))
          ? a.name.localeCompare(b.name) : samples[b.id]?.data ? 1 : -1);
  }, [connections, query, samples, sort]);

  const toggleMetric = (id: string) => setMetrics(previous => ({ ...previous, [id as MetricId]: !previous[id as MetricId] }));
  const refreshHosts = () => { samplesRef.current = {}; setSamples({}); setRefresh(value => value + 1); };
  const usable = (id: MetricId) => metrics[id];

  return <div className="ssh-dashboard" data-testid="ssh-dashboard">
    <SidebarToolbar search={{ value: query, onChange: event => setQuery(event.target.value), 'aria-label': t('Search SSH hosts'),
      placeholder: t('Search SSH hosts…'), 'data-testid': 'ssh-dashboard-search' }}>
      <IconBtn title={t('Refresh remote resources')} data-testid="ssh-dashboard-refresh" onClick={refreshHosts}><RefreshCw size={iconSizes.control} /></IconBtn>
      <IconBtn title={t('All hosts')} data-testid="ssh-manage-hosts" onClick={onManage}><Settings size={iconSizes.control} /></IconBtn>
    </SidebarToolbar>
    <header className="ssh-dashboard-header">
      <div><DataUsage size={iconSizes.navigation} /><h2>{t('Resource dashboard')}</h2><span>{t('{{count}} hosts', { count: connections.length })}</span></div>
      <div className="ssh-dashboard-controls">
        <Select aria-label={t('Host view')} value="dashboard" options={[{ value: 'dashboard', label: t('Resource dashboard') }, { value: 'manage', label: t('All hosts') }]}
          onChange={value => { if (value === 'manage') onManage(); }} style={{ width: 128 }} />
        <Select aria-label={t('Host list order')} value={sort} options={[
          { value: 'status', label: t('Status') }, { value: 'name', label: t('Name') }, { value: 'recent', label: t('Last connected') },
        ]} onChange={value => setSort(value as Sort)} style={{ width: 132 }} />
        <IconBtn title={t('Card view')} data-active={layout === 'cards'} onClick={() => setLayout('cards')}><Grid size={iconSizes.control} /></IconBtn>
        <IconBtn title={t('Table view')} data-active={layout === 'table'} onClick={() => setLayout('table')}><Columns2 size={iconSizes.control} /></IconBtn>
        <span className="ssh-dashboard-metric-menu">
          <IconBtn ref={metricTrigger} title={t('More metrics')} data-active={selectedMetrics > 0} data-testid="ssh-dashboard-metrics"
            onClick={() => setMetricMenu(value => !value)}><ArrowSort size={iconSizes.control} /></IconBtn>
          {metricMenu && <CheckboxMenu title={t('Collect and show')} triggerRef={metricTrigger}
            style={{ right: 0, top: 'calc(100% + 4px)' }} onClose={() => setMetricMenu(false)}
            options={METRIC_IDS.map(id => ({ id, label: t(METRIC_LABELS[id]), checked: metrics[id] }))} onToggle={toggleMetric} />}
        </span>
      </div>
    </header>

    {selectedMetrics === 0 && <div className="ssh-dashboard-paused" role="status">{t('Metrics collection is paused. Turn on one or more metrics to collect host status.')}</div>}

    {!connections.length ? <div className="ssh-dashboard-empty"><SshIcon size={32} />
      <strong>{t('No hosts yet')}</strong><span>{t('Add a host or import an existing SSH configuration.')}</span>
      <button type="button" className="outline-button" onClick={onManage}>{t('Manage hosts')}</button></div>
      : layout === 'cards' ? <div className="ssh-dashboard-grid">
        {visible.map(connection => {
          const state = samples[connection.id] ?? {};
          const sample = state.data;
          return <article key={connection.id} className="ssh-dashboard-card" role="button" tabIndex={0} data-testid={`ssh-dashboard-host-${connection.id}`}
            onClick={() => setSelected(connection)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelected(connection); } }}>
            <div className="ssh-dashboard-card-title">
              <SshIcon size={iconSizes.row} style={{ color: iconColorCss(iconColors[iconColorKey('ssh', connection.id)]) }} />
              <span><strong>{connection.name}</strong><small>{connection.user}@{connection.host}:{connection.port ?? 22}</small></span>
              {usable('status') && <i className="ssh-dashboard-status-dot" data-online={sample ? 'true' : undefined}
                data-tip={sample ? t('Online') : t('Offline')} />}
            </div>
            {usable('cpu') && <MetricBar label="CPU" value={state.cpu ?? percent(sample?.cpuTotal == null ? null : sample.cpuTotal - (sample.cpuIdle ?? 0), sample?.cpuTotal)} />}
            {usable('memory') && <MetricBar label={t('Memory')} value={percent(sample?.memoryTotal == null ? null : sample.memoryTotal - (sample.memoryAvailable ?? 0), sample?.memoryTotal)} />}
            {usable('disk') && <MetricBar label={t('Disk')} value={percent(sample?.diskUsed, sample?.diskTotal)} />}
            {usable('network') && <div className="ssh-dashboard-kv"><span>{t('Network')}</span><strong>{rate(state.download) ?? '—'} ↓ · {rate(state.upload) ?? '—'} ↑</strong></div>}
            {usable('load') && <div className="ssh-dashboard-kv"><span>{t('Load')}</span><strong>{sample?.load || '—'}</strong></div>}
            {usable('uptime') && <div className="ssh-dashboard-kv"><span>{t('Uptime')}</span><strong>{sample?.uptimeSeconds != null ? statusDuration(sample.uptimeSeconds) : '—'}</strong></div>}
            <footer><span>{metricSummary(sample, state)}</span><span>{state.updatedAt ? new Date(state.updatedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : t('Collecting…')}</span></footer>
          </article>;
        })}
        {!visible.length && <div className="ssh-dashboard-empty">{t('No matching hosts')}</div>}
      </div> : <div className="ssh-dashboard-table-wrap">
        <table className="ssh-dashboard-table"><thead><tr><th>{t('Host')}</th>{usable('status') && <th>{t('Status')}</th>}
          {usable('cpu') && <th>CPU</th>}{usable('memory') && <th>{t('Memory')}</th>}{usable('disk') && <th>{t('Disk')}</th>}
          {usable('network') && <th>{t('Network')}</th>}{usable('load') && <th>{t('Load')}</th>}{usable('uptime') && <th>{t('Uptime')}</th>}</tr></thead>
          <tbody>{visible.map(connection => { const state = samples[connection.id] ?? {}; const sample = state.data; return <tr key={connection.id}
            tabIndex={0} data-testid={`ssh-dashboard-host-${connection.id}`} onClick={() => setSelected(connection)}
            onKeyDown={event => { if (event.key === 'Enter') setSelected(connection); }}>
            <td><strong>{connection.name}</strong><small>{connection.user}@{connection.host}:{connection.port ?? 22}</small></td>
            {usable('status') && <td><span className="ssh-dashboard-table-status" data-online={sample ? 'true' : undefined}>{sample ? t('Online') : state.error ? t('Offline') : t('Collecting…')}</span></td>}
            {usable('cpu') && <td>{state.cpu != null ? `${state.cpu}%` : '—'}</td>}{usable('memory') && <td>{percent(sample?.memoryTotal == null ? null : sample.memoryTotal - (sample.memoryAvailable ?? 0), sample?.memoryTotal) ?? '—'}{sample?.memoryTotal ? '%' : ''}</td>}
            {usable('disk') && <td>{percent(sample?.diskUsed, sample?.diskTotal) ?? '—'}{sample?.diskTotal ? '%' : ''}</td>}
            {usable('network') && <td>{rate(state.download) ?? '—'} / {rate(state.upload) ?? '—'}</td>}
            {usable('load') && <td>{sample?.load || '—'}</td>}{usable('uptime') && <td>{sample?.uptimeSeconds != null ? statusDuration(sample.uptimeSeconds) : '—'}</td>}
          </tr>; })}</tbody></table>
      </div>}

    {selected && createPortal(<div className="new-tab-overlay" onClick={() => setSelected(null)}>
      <section className="workspace-floating workspace-floating-dialog ssh-dashboard-detail" role="dialog" aria-modal="true"
        aria-label={t('Host details')} onClick={event => event.stopPropagation()}>
        <header><SshIcon size={28} /><div><h2>{selected.name}</h2><span>{selected.user}@{selected.host}:{selected.port ?? 22}</span></div></header>
        <DashboardDetails sample={samples[selected.id]?.data} state={samples[selected.id] ?? {}} />
        <footer><button type="button" className="outline-button" onClick={() => setSelected(null)}>{t('Close')}</button>
          <button type="button" className="primary-button" onClick={() => { onOpenTerminal(selected); setSelected(null); }}>{t('Open terminal')}</button></footer>
      </section>
    </div>, document.body)}
  </div>;
}

function MetricBar({ label, value }: { label: string; value: number | null }) {
  return <div className="ssh-dashboard-metric"><span>{label}</span><i><b style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%` }} /></i><strong>{value == null ? '—' : `${value}%`}</strong></div>;
}

function DashboardDetails({ sample, state }: { sample?: SshSystemStatus; state: DashboardHostState }) {
  return <div className="ssh-dashboard-detail-body">
    <p>{metricSummary(sample, state)}</p>
    {sample && <>
      <div className="ssh-dashboard-kv"><span>CPU</span><strong>{state.cpu == null ? '—' : `${state.cpu}%`}</strong></div>
      <div className="ssh-dashboard-kv"><span>{t('Memory')}</span><strong>{sample.memoryTotal ? `${fmtSize(sample.memoryTotal - (sample.memoryAvailable ?? 0))} / ${fmtSize(sample.memoryTotal)}` : '—'}</strong></div>
      <div className="ssh-dashboard-kv"><span>{t('Disk')}</span><strong>{sample.diskTotal ? `${fmtSize(sample.diskUsed ?? 0)} / ${fmtSize(sample.diskTotal)}` : '—'}</strong></div>
      <div className="ssh-dashboard-kv"><span>{t('Network')}</span><strong>{rate(state.download) ?? '—'} ↓ · {rate(state.upload) ?? '—'} ↑</strong></div>
      <div className="ssh-dashboard-kv"><span>{t('Load')}</span><strong>{sample.load || '—'}</strong></div>
      <div className="ssh-dashboard-kv"><span>{t('Uptime')}</span><strong>{sample.uptimeSeconds != null ? statusDuration(sample.uptimeSeconds) : '—'}</strong></div>
    </>}
  </div>;
}
