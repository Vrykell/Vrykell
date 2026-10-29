import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { t } from '@i18n';
import Select from '@ui/fields/Select';
import CheckboxMenu from '@ui/menus/CheckboxMenu';
import { IconBtn } from '@ui/actions/UiBtn';
import SidebarToolbar from '@ui/layout/SidebarToolbar';
import SidebarItem from '@ui/layout/sidebarItem';
import { ListReorderPlaceholder, ListReorderPreview, useListReorderDrag } from '@ui/layout/listReorder';
import { OutlineButton } from '@ui/actions/OutlineButton';
import { TextButton } from '@ui/actions/TextButton';
import Toggle from '@ui/fields/Toggle';
import ToolDialog from '@ui/feedback/ToolDialog';
import SegmentedControl from '@ui/fields/SegmentedControl';
import { AlertCircle, ArrowDown, ArrowUp, ArrowLeftRight, ChevronDown, Columns2, EyeOff, Folder, Grid, Lock, MoreHorizontal, Plus, RefreshCw, ServerStack, Star, StarFilled, Tag, iconSizes } from '@ui/icons';
import { isSshAuthenticationFailure } from '../model/fileServiceState';
import { requestSshAuthentication, useSessionAuthenticationStore } from '../stores/sessionAuthentication';
import ContextMenu, { type MenuAnchor } from '@ui/menus/ContextMenu';
import { TerminalProfileIcon } from '@ui/icons/shellIcons';
import { safeJsonParse, safeLocalStorageGet, safeLocalStorageSet } from '@utils/errorHandler';
import { EMPTY_HOST_METADATA, useHostLibrary } from '../stores/hostLibrary';
import { groupHosts } from '../model/hostTags';
import { hostLastConnected } from '../model/hostDisplay';
import { useHostMetadataMenu } from './useHostMetadataMenu';
import { ensureSshLoaded, useSshStore } from '../stores/store';
import type { SshConnection } from '../services/api';
import { HOST_METRICS, resourcePercent, resourceRate, useHostResources, type HostMetric, type HostMetricSelection, type HostResourceState } from '../hooks/useHostResources';
import { statusDuration } from './SshStatusPanel';
import HostTag, { HostTagDot } from './HostTag';
import './SshDashboard.css';

const PREFERENCES_KEY = 'vrykell-host-view-v2';
const METRIC_LABELS: Record<HostMetric, string> = { status: 'Status', cpu: 'CPU', memory: 'Memory', disk: 'Disk', network: 'Network', load: 'Load', uptime: 'Uptime' };
type Sort = 'manual' | 'recent' | 'name' | 'cpu' | 'memory' | 'disk';
function readPreferences() {
  const saved = safeJsonParse<Record<string, unknown>>(safeLocalStorageGet(PREFERENCES_KEY) ?? '{}');
  const metrics = Object.fromEntries(HOST_METRICS.map(id => [id, !(saved?.metrics && typeof saved.metrics === 'object' && (saved.metrics as Record<string, unknown>)[id] === false)])) as HostMetricSelection;
  return { metrics, resources: saved?.resources === true, layout: saved?.layout === 'cards' ? 'cards' as const : 'table' as const,
    sort: (saved?.resources === true ? ['manual', 'name', 'cpu', 'memory', 'disk'] : ['manual', 'name']).includes(String(saved?.sort)) ? saved!.sort as Sort : 'recent' as Sort };
}

export default function SshDashboard({ active = true, onManage, onImport, onQuickConnect, onDelete, onOpenTerminal, onForwarding }: {
  active?: boolean;
  onManage: () => void;
  onImport?: () => void;
  onForwarding?: () => void;
  onQuickConnect?: () => void;
  onDelete?: (connection: SshConnection) => void;
  onOpenTerminal: (connection: SshConnection) => void;
}) {
  const connections = useSshStore(state => state.connections);
  const loaded = useSshStore(state => state.loaded);
  const metadata = useHostLibrary(state => state.hosts);
  const initial = useMemo(readPreferences, []);
  const [layout, setLayout] = useState(initial.layout);
  const [resources, setResources] = useState(initial.resources);
  const [metrics, setMetrics] = useState(initial.metrics);
  const [sort, setSort] = useState(initial.sort);
  const startDrag = useListReorderDrag({ listId: 'ssh-hosts', onDrop: (drag, target) => {
    if (!target?.itemId || drag.id === target.itemId) return;
    const state = useSshStore.getState(); const from = state.connections.findIndex(connection => connection.id === drag.id);
    const remaining = state.connections.filter(connection => connection.id !== drag.id); const over = remaining.findIndex(connection => connection.id === target.itemId);
    if (from < 0 || over < 0) return;
    state.reorder(from, over + (target.after ? 1 : 0)); setSort('manual');
  } });
  const [query, setQuery] = useState('');
  const [starredOnly, setStarredOnly] = useState(false);
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [groupFilter, setGroupFilter] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState('none');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [details, setDetails] = useState<SshConnection | null>(null);
  const [menu, setMenu] = useState<{ id: string; anchor: MenuAnchor } | null>(null);
  const [tools, setTools] = useState<HTMLElement | null>(null);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [metricsOpen, setMetricsOpen] = useState(false);
  const tagTrigger = useRef<HTMLButtonElement>(null);
  const groupTrigger = useRef<HTMLButtonElement>(null);
  const metricTrigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLDivElement>(null);
  const collecting = useMemo(() => connections.filter(connection => !metadata[connection.id]?.resourceDisabled), [connections, metadata]);
  const { samples, refresh } = useHostResources(collecting, metrics, active && loaded && resources);
  const authenticationRevisions = useSessionAuthenticationStore(state => state.revisions);
  useEffect(() => { if (resources) refresh(); }, [authenticationRevisions]);
  const retryHost = (connection: SshConnection) => {
    if (metadata[connection.id]?.resourceDisabled) useHostLibrary.getState().update(connection.id, { resourceDisabled: false });
    setResources(true);
    if (samples[connection.id]?.error && isSshAuthenticationFailure(samples[connection.id].error!)) requestSshAuthentication({ connectionId: connection.id, host: connection.host, port: connection.port, user: connection.user, identityFile: connection.identityFile });
    else refresh();
  };
  const annotations = useHostMetadataMenu({ onConnect: onOpenTerminal, onRetry: retryHost });
  const knownTags = [...new Set([...connections.flatMap(connection => metadata[connection.id]?.tags ?? []), ...tagFilter])].sort();
  const groups = groupHosts(connections, metadata, 'group');
  if (groupFilter !== null && !groups.some(group => group.name === groupFilter)) groups.push({ name: groupFilter, hosts: [] });
  const toggleResources = (value: boolean) => {
    setResources(value);
    if (!value && !['manual', 'recent', 'name'].includes(sort)) setSort('recent');
  };

  useEffect(() => { ensureSshLoaded(); }, []);
  useEffect(() => { safeLocalStorageSet(PREFERENCES_KEY, JSON.stringify({ layout, resources, metrics, sort })); }, [layout, resources, metrics, sort]);
  useEffect(() => {
    if (!active) return;
    const focusSearch = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || !event.shiftKey || event.key.toLowerCase() !== 'k') return;
      event.preventDefault(); search.current?.querySelector('input')?.focus();
    };
    window.addEventListener('keydown', focusSearch);
    return () => window.removeEventListener('keydown', focusSearch);
  }, [active]);
  const visible = useMemo(() => {
    const value = query.trim().toLowerCase().replace(/^ssh\s+/, '');
    const filtered = connections.filter(connection => {
      const meta = metadata[connection.id] ?? EMPTY_HOST_METADATA;
      return (!starredOnly || meta.starred) && (groupFilter === null || meta.group === groupFilter)
        && tagFilter.every(tag => meta.tags.includes(tag))
        && (!value || [connection.name, connection.host, connection.user, `${connection.user}@${connection.host}`, meta.group, ...meta.tags].some(part => part.toLowerCase().includes(value)));
    });
    const metric = (connection: SshConnection) => {
      const state = samples[connection.id]; const sample = state?.data;
      return sort === 'cpu' ? state?.cpu ?? -1 : sort === 'memory' ? resourcePercent(sample?.memoryTotal == null ? null : sample.memoryTotal - (sample.memoryAvailable ?? 0), sample?.memoryTotal) ?? -1 : resourcePercent(sample?.diskUsed, sample?.diskTotal) ?? -1;
    };
    return sort === 'manual' ? filtered : filtered.sort((first, second) => sort === 'name' ? first.name.localeCompare(second.name) : resources && ['cpu', 'memory', 'disk'].includes(sort) ? metric(second) - metric(first) : (second.lastOpenedAt ?? 0) - (first.lastOpenedAt ?? 0));
  }, [connections, metadata, query, starredOnly, groupFilter, tagFilter, samples, sort, resources]);
  const grouped = groupHosts(visible, metadata, groupBy);
  const showMenu = (connection: SshConnection, trigger: HTMLElement, x: number, y: number) => { setSelectedId(connection.id); setMenu({ id: connection.id, anchor: { x, y, trigger } }); };
  const address = (connection: SshConnection) => `${connection.user ? `${connection.user}@` : ''}${connection.host}:${connection.port ?? 22}`;
  const lastConnected = (connection: SshConnection) => hostLastConnected(connection.lastOpenedAt);
  const favorite = (connection: SshConnection) => metadata[connection.id]?.starred ? <StarFilled size={14} color="var(--favorite-color)" aria-label={t('Starred')} /> : null;
  const icon = (connection: SshConnection) => <span className="ssh-dashboard-host-icon"><TerminalProfileIcon kind="ssh" connectionId={connection.id} size={iconSizes.row} /><i className="ssh-dashboard-status-dot" data-failure={samples[connection.id]?.error ? isSshAuthenticationFailure(samples[connection.id].error!) ? 'authentication' : samples[connection.id].data ? 'error' : undefined : undefined} data-online={samples[connection.id]?.data && !samples[connection.id]?.error ? 'true' : undefined} /></span>;
  const tags = (connection: SshConnection) => <span className="ssh-host-tags">{metadata[connection.id]?.tags.map(tag => <HostTag key={tag} tag={tag} />)}</span>;
  const connectButton = (connection: SshConnection) => <TextButton className="user-primary-action ssh-host-connect" aria-label={t('Connect to {{name}}', { name: connection.name })} onClick={event => { event.stopPropagation(); onOpenTerminal(connection); }}>{t('Connect')}</TextButton>;
  const columns = resources ? `20px minmax(90px, 1.5fr) minmax(90px, 1.2fr) ${(['cpu', 'memory', 'disk'] as const).filter(metric => metrics[metric]).map(() => 'calc(96px * var(--ui-font-scale))').join(' ')} 60px`
    : '20px minmax(120px, 1fr) minmax(140px, 1.4fr) minmax(90px, 1fr) 100px 60px';

  return <div className="ssh-dashboard ssh-host-management" data-testid="ssh-dashboard" data-resources={resources} data-layout={layout} style={{ '--ssh-host-list-columns': columns } as CSSProperties}>
    <header className="ssh-host-page-header ssh-management-header">
      <div className="ssh-host-page-title"><h2>{t('Hosts')}</h2><span>{t('{{count}} hosts', { count: connections.length })}</span></div>
      <div className="ssh-host-page-actions">
        <div ref={search} className="ssh-host-search"><SidebarToolbar search={{ value: query, onChange: event => setQuery(event.target.value), placeholder: t('Search hosts…'), 'aria-label': t('Search hosts…'), 'data-testid': 'ssh-search' }} /></div>
        <div className="ssh-host-primary-actions">
          {onForwarding && <OutlineButton aria-label={t('Port forwarding')} data-testid="ssh-forwarding-entry" onClick={onForwarding}><ArrowLeftRight size={14} />{t('Port forwarding')}</OutlineButton>}
          {onImport && <OutlineButton aria-label={t('ssh.import.open')} data-testid="ssh-import-btn" onClick={onImport}><ArrowDown size={14} />{t('Import')}</OutlineButton>}
          <div className="ssh-host-new-actions"><OutlineButton className="primary-button" data-testid="ssh-new-btn" onClick={onManage}><Plus size={14} />{t('New host')}</OutlineButton>
            <OutlineButton className="primary-button" aria-label={t('Host actions')} data-testid="ssh-host-actions" onClick={event => setTools(event.currentTarget)}><ChevronDown size={14} /></OutlineButton></div>
        </div>
      </div>
    </header>
    <div className="ssh-host-browser scroll-region" data-testid="ssh-host-browser">
    <div className="ssh-host-filter-toolbar">
      <div className="ssh-host-filter-actions">
        <TextButton className="ssh-host-filter" aria-pressed={starredOnly} data-testid="ssh-host-favorites" onClick={() => setStarredOnly(value => !value)}>{starredOnly ? <StarFilled size={16} color="var(--favorite-color)" /> : <Star size={16} />}{t('Favorites')}</TextButton>
        <TextButton ref={tagTrigger} className="ssh-host-filter" aria-expanded={tagsOpen} disabled={!knownTags.length} data-tip={!knownTags.length ? t('Add tags when editing a host.') : undefined} data-testid="ssh-host-tag-filter" onClick={() => { setGroupsOpen(false); setTagsOpen(value => !value); }}><Tag size={16} />{t('Tags')}{tagFilter.length > 0 && <span>{tagFilter.length}</span>}<ChevronDown size={12} /></TextButton>
        <TextButton ref={groupTrigger} className="ssh-host-filter" aria-expanded={groupsOpen} disabled={!groups.some(group => !!group.name)} data-testid="ssh-host-group-filter" onClick={() => { setTagsOpen(false); setGroupsOpen(value => !value); }}><Folder size={16} />{t('Group')}{groupFilter !== null && <span>1</span>}<ChevronDown size={12} /></TextButton>
      </div>
      <div className="ssh-host-view-actions">
        <Select aria-label={t('Host list order')} value={sort} options={[{ value: 'manual', label: t('Manual order') }, { value: 'recent', label: t('Last connected') }, { value: 'name', label: t('Name') }, ...(resources ? (['cpu', 'memory', 'disk'] as const).map(value => ({ value, label: t(METRIC_LABELS[value]) })) : [])]} onChange={value => setSort(value as Sort)} style={{ width: 118 }} />
        <span className="ssh-host-resource-toggle"><Toggle compact on={resources} onChange={toggleResources} label={t('Resource usage')} /><span onClick={() => toggleResources(!resources)}>{t('Resource usage')}</span></span>
        <SegmentedControl variant="buttons" label={t('Host view')} value={layout} onChange={setLayout} options={[{ value: 'table', label: t('List'), ariaLabel: t('Table view'), icon: <Columns2 size={14} /> }, { value: 'cards', label: t('Cards'), ariaLabel: t('Card view'), icon: <Grid size={14} /> }]} />
        {resources && <span className="ssh-dashboard-metric-menu"><IconBtn ref={metricTrigger} title={t('More metrics')} data-testid="ssh-dashboard-metrics" onClick={() => setMetricsOpen(value => !value)}><MoreHorizontal size={16} /></IconBtn>
          {metricsOpen && <CheckboxMenu anchored title={t('Collect and show')} triggerRef={metricTrigger} checkmark options={HOST_METRICS.map(id => ({ id, label: t(METRIC_LABELS[id]), checked: metrics[id] }))} onToggle={id => setMetrics(current => ({ ...current, [id]: !current[id] }))} onClose={() => setMetricsOpen(false)}
            footer={<TextButton className="ssh-metrics-refresh" data-testid="ssh-dashboard-refresh" onClick={() => { refresh(); setMetricsOpen(false); }}><RefreshCw size={14} />{t('Refresh')}</TextButton>} />}
        </span>}
      </div>
    </div>
    {tagsOpen && <CheckboxMenu anchored checkmark title={t('Host tags')} triggerRef={tagTrigger} style={{ width: 280 }} options={knownTags.map(tag => ({ id: tag, label: tag, checked: tagFilter.includes(tag), icon: <HostTagDot tag={tag} /> }))} onToggle={tag => setTagFilter(current => current.includes(tag) ? current.filter(value => value !== tag) : [...current, tag])} onClose={() => setTagsOpen(false)} />}
    {groupsOpen && <CheckboxMenu anchored checkmark title={t('Host groups')} triggerRef={groupTrigger} style={{ width: 280 }} options={groups.map(group => ({ id: group.name, label: group.name || t('Ungrouped'), checked: groupFilter === group.name, icon: <Folder size={16} />, count: group.hosts.length }))} onToggle={group => setGroupFilter(current => current === group ? null : group)} onClose={() => setGroupsOpen(false)} />}
    {resources && HOST_METRICS.every(id => !metrics[id]) && <div className="ssh-dashboard-paused" role="status">{t('Metrics collection is paused. Turn on one or more metrics to collect host status.')}</div>}
    {layout === 'table' && <div className="ssh-host-columns"><span /><span>{t('Name')}</span>{resources ? <><span>{t('Status')}</span>{(['cpu', 'memory', 'disk'] as const).filter(metric => metrics[metric]).map(metric => <span key={metric}>{t(METRIC_LABELS[metric])}</span>)}</> : <><span>{t('Address')}</span><span>{t('Tags')}</span><span>{t('Last connected')}</span></>}<span /></div>}
    <div className={layout === 'table' ? 'scroll-region ssh-host-list' : 'scroll-region ssh-dashboard-grid'} data-reorder-list={layout === 'table' ? 'ssh-hosts' : undefined}>
      {!visible.length ? <div className="search-empty-state">{t(connections.length ? 'No matching connections' : 'No SSH connections yet. Select + to create one.')}</div> : grouped.map(group => <section key={group.name} className={layout === 'cards' ? 'ssh-dashboard-group-section' : undefined}>
        {groupBy !== 'none' && <h3 className="ssh-dashboard-group"><Folder size={16} />{group.name || t(groupBy === 'tags' ? 'Untagged' : 'Ungrouped')}<span>{group.hosts.length}</span></h3>}
        {group.hosts.map(connection => <Fragment key={connection.id}>{layout === 'table' && <ListReorderPlaceholder listId="ssh-hosts" itemId={connection.id} />}{layout === 'table' ? <SidebarItem active={selectedId === connection.id} icon={icon(connection)} title={connection.name} titleAccessory={favorite(connection)} subtitle={resources ? undefined : address(connection)} tooltip={address(connection)} testId={`ssh-row-${connection.id}`} tabIndex={0}
          reorderItemId={connection.id} reorderListId="ssh-hosts" reorderKind="ssh" onPointerDown={event => startDrag(event, { id: connection.id, kind: 'ssh' })}
          badge={resources ? <HostResources state={samples[connection.id] ?? {}} disabled={metadata[connection.id]?.resourceDisabled} metrics={metrics} onRetry={() => retryHost(connection)} /> : <span className="ssh-host-row-metadata">{tags(connection)}<span className="ssh-host-row-last-connected">{lastConnected(connection)}</span></span>}
          trailingActions={[{ label: t('Connect to {{name}}', { name: connection.name }), control: connectButton(connection) }]}
          onClick={() => setSelectedId(connection.id)} onDoubleClick={() => onOpenTerminal(connection)}
          onContextMenu={event => { event.preventDefault(); showMenu(connection, event.currentTarget, event.clientX, event.clientY); }}
          onKeyDown={event => {
            if (event.target !== event.currentTarget) return;
            if (event.key === 'Enter') { event.preventDefault(); onOpenTerminal(connection); }
            if (event.key === ' ') { event.preventDefault(); setSelectedId(connection.id); setDetails(connection); }
            if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') { event.preventDefault(); const box = event.currentTarget.getBoundingClientRect(); showMenu(connection, event.currentTarget, box.left, box.bottom); }
          }} /> : <article className="ssh-dashboard-card" role="button" data-testid={`ssh-row-${connection.id}`} data-active={selectedId === connection.id} tabIndex={0} onClick={() => setSelectedId(connection.id)} onDoubleClick={() => onOpenTerminal(connection)}
          onContextMenu={event => { event.preventDefault(); showMenu(connection, event.currentTarget, event.clientX, event.clientY); }} onKeyDown={event => {
            if (event.target !== event.currentTarget) return;
            if (event.key === 'Enter') { event.preventDefault(); onOpenTerminal(connection); }
            if (event.key === ' ') { event.preventDefault(); setSelectedId(connection.id); setDetails(connection); }
            if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') { event.preventDefault(); const box = event.currentTarget.getBoundingClientRect(); showMenu(connection, event.currentTarget, box.left, box.bottom); }
          }}>
          <div className="ssh-dashboard-card-title">{icon(connection)}<strong>{connection.name}</strong>{favorite(connection)}{connectButton(connection)}</div>
          <div className="ssh-dashboard-address">{address(connection)}</div>{tags(connection)}
          {resources && <HostResources state={samples[connection.id] ?? {}} disabled={metadata[connection.id]?.resourceDisabled} metrics={metrics} compact onRetry={() => retryHost(connection)} />}
          {!samples[connection.id]?.error && <span className="ssh-host-last-connected">{lastConnected(connection)}</span>}
        </article>}</Fragment>)}
      </section>)}
      {layout === 'table' && visible.length > 0 && <ListReorderPlaceholder listId="ssh-hosts" itemId={visible[visible.length - 1]!.id} after />}
    </div>
    </div>
    <ListReorderPreview listId="ssh-hosts">{drag => <ServerStack size={20} aria-label={connections.find(connection => connection.id === drag.id)?.name} />}</ListReorderPreview>
    {details && <ToolDialog label={t('Host details')} onClose={() => setDetails(null)} closePlacement="footer"><div className="ssh-host-details"><strong>{details.name}</strong><code>{address(details)}</code>{tags(details)}<span>{lastConnected(details)}</span>{details.notes && <p>{details.notes}</p>}{resources && <HostResources state={samples[details.id] ?? {}} disabled={metadata[details.id]?.resourceDisabled} metrics={metrics} compact onRetry={() => retryHost(details)} />}</div></ToolDialog>}
    {menu && <ContextMenu anchor={menu.anchor} items={[...annotations.items(menu.id, menu.anchor), ...(onDelete ? [{ label: t('Delete'), danger: true, onClick: () => { const connection = connections.find(value => value.id === menu.id); if (connection) onDelete(connection); } }] : [])]} onClose={() => setMenu(null)} />}
    {tools && <ContextMenu anchor={{ x: tools.getBoundingClientRect().right, y: tools.getBoundingClientRect().bottom, trigger: tools }} onClose={() => setTools(null)} items={[
      ...(onQuickConnect ? [{ label: t('ssh.quick.connect'), onClick: onQuickConnect }] : []),
      { label: t('Group hosts by'), submenu: { items: [{ value: 'none', label: t('No grouping') }, { value: 'group', label: t('Host groups') }, { value: 'tags', label: t('Host tags') }].map(option => ({ label: option.label, checked: groupBy === option.value, onClick: () => setGroupBy(option.value) })) } },
    ]} />}
  </div>;
}

export function HostResources({ state: collected, metrics, compact = false, disabled = false, onRetry }: { state: HostResourceState; metrics: HostMetricSelection; compact?: boolean; disabled?: boolean; onRetry: () => void }) {
  const state = disabled ? {} : collected;
  const sample = state.data;
  const authentication = !!state.error && isSshAuthenticationFailure(state.error);
  const offline = !!state.error && !sample && !authentication && /offline|refused|timed?\s?out|unreachable|network|disconnected|无法连接|连接.*断/i.test(state.error);
  const retry = <TextButton className="ssh-resource-retry" aria-label={t('Retry host status')} disabled={state.busy} onClick={event => { event.stopPropagation(); onRetry(); }}>{compact ? t('Retry') : <RefreshCw size={14} />}</TextButton>;
  const errorLabel = t(authentication ? 'Login failed' : offline ? 'Offline' : 'Read failed');
  const detail = authentication ? t('The server rejected the username, password or private key.') : state.error ?? '';
  return <span className="ssh-host-resource-summary" data-stale={!!state.error && !!sample || undefined}>
    {!sample && state.error && compact ? <span className="ssh-resource-state" data-kind={authentication ? 'authentication' : 'offline'} role="status">
      {authentication ? <Lock size={22} /> : offline ? <EyeOff size={22} /> : <AlertCircle size={22} />}<strong>{errorLabel}</strong>
      {!offline && <span>{detail}</span>}{!offline && retry}
    </span> : <>
    {state.error && !compact && <span className="ssh-resource-inline-error" data-kind={authentication ? 'authentication' : offline ? 'offline' : 'error'}><span data-tip={detail} aria-label={`${errorLabel}: ${detail}`}>{errorLabel}{!offline && `: ${detail}`}</span>{!offline && retry}</span>}
    {!state.error && !compact && <span className="ssh-dashboard-table-status" data-online={sample ? 'true' : undefined}>{disabled ? t('Not collected') : !metrics.status ? '—' : sample && !sample.system.toLowerCase().includes('linux') && sample.memoryTotal == null ? t('Online status only ({{system}})', { system: sample.system }) : t(sample ? 'Online' : state.busy ? 'Connecting…' : 'Offline')}</span>}
    {metrics.cpu && <MetricBar label="CPU" value={state.cpu ?? null} />}
    {metrics.memory && <MetricBar label={t('Memory')} value={resourcePercent(sample?.memoryTotal == null ? null : sample.memoryTotal - (sample.memoryAvailable ?? 0), sample?.memoryTotal)} />}
    {metrics.disk && <MetricBar label={t('Disk')} value={resourcePercent(sample?.diskUsed, sample?.diskTotal)} />}
    {compact && state.error && sample && <span className="ssh-resource-card-error" role="status"><AlertCircle size={13} /><span data-tip={detail}>{t('Read failed')}: {detail}</span></span>}
    {(metrics.network || metrics.load || metrics.uptime) && <span className="ssh-host-resource-footer">
      {metrics.network && <span className="ssh-dashboard-network"><ArrowDown size={12} />{resourceRate(state.download)}<ArrowUp size={12} />{resourceRate(state.upload)}</span>}
      {metrics.load && <span>{t('Load')} {sample?.load || '—'}</span>}
      {metrics.uptime && <span>{t('Uptime')} {sample?.uptimeSeconds != null ? statusDuration(sample.uptimeSeconds) : '—'}</span>}
    </span>}
    {compact && state.error && sample && <span className="ssh-resource-last-read"><span>{t('Last read {{time}}', { time: new Date(state.updatedAt ?? 0).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })}</span>{retry}</span>}
    </>}
  </span>;
}

function MetricBar({ label, value }: { label: string; value: number | null }) {
  return <span className="ssh-dashboard-metric" data-empty={value == null || undefined} data-critical={value != null && value >= 90}><span>{label}</span>{value != null && <i><b style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></i>}<strong>{value == null ? '—' : `${value}%`}</strong></span>;
}
