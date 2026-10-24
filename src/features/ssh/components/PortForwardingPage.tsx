import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { SshForwardingRule } from '@core/ssh';
import { t } from '@i18n';
import { TextInput } from '@ui/fields/TextInput';
import { TextButton } from '@ui/actions/TextButton';
import { OutlineButton } from '@ui/actions/OutlineButton';
import { IconButton } from '@ui/actions/IconButton';
import { ChevronRight, ArrowRight, Pencil, Plus, RefreshCw, Trash2 } from '@ui/icons';
import { useWorkspaceNavigation } from '@features/workspace';
import Select from '@ui/fields/Select';
import Toggle from '@ui/fields/Toggle';
import { Checkbox } from '@ui/fields/Checkbox';
import ErrorBox from '@ui/feedback/ErrorBox';
import ConfirmDialog from '@ui/feedback/ConfirmDialog';
import { useDialogKeyboard } from '@ui/hooks/useDialogKeyboard';
import { ensureSshLoaded, useSshStore } from '../stores/store';
import type { SshConnection } from '../services/api';
import { connectionRules, listForwardingStatus, startForwarding, stopForwarding, withForwardingRules, type ForwardingStatus } from '../services/forwarding';
import './PortForwardingPage.css';

const emptyRule = (): SshForwardingRule => ({ id: `forward-${crypto.randomUUID()}`, name: '', kind: 'local', bind: '127.0.0.1', port: 8080, host: 'localhost', targetPort: 80, autoStart: false });

export default function PortForwardingPage({ active = true }: { active?: boolean }) {
  const connections = useSshStore(state => state.connections);
  const [statuses, setStatuses] = useState<ForwardingStatus[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ connectionId: string; rule: SshForwardingRule; create: boolean } | null>(null);
  const [deleting, setDeleting] = useState<{ connection: SshConnection; rule: SshForwardingRule } | null>(null);
  const refresh = async () => { try { setStatuses(await listForwardingStatus()); } catch (reason) { setError(String(reason)); } };
  useEffect(() => { ensureSshLoaded(); }, []);
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    const collect = () => { void listForwardingStatus().then(statuses => { if (!disposed) setStatuses(statuses); }).catch(reason => { if (!disposed) setError(String(reason)); }); };
    collect();
    const timer = setInterval(collect, 2000);
    return () => { disposed = true; clearInterval(timer); };
  }, [active]);
  const action = async (id: string, operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(id); setError('');
    try { await operation(); await refresh(); } catch (reason) { setError(String(reason)); } finally { setBusy(null); }
  };
  const save = async (connectionId: string, rule: SshForwardingRule) => {
    const connection = connections.find(connection => connection.id === connectionId);
    if (!connection) throw new Error(t('Select a saved host.'));
    const previous = editing?.create ? undefined : editing?.rule.id;
    if (previous) await stopForwarding(connection.id, previous);
    const rules = connectionRules(connection);
    await useSshStore.getState().save(withForwardingRules(connection, previous ? rules.map(item => item.id === previous ? rule : item) : [...rules, rule]));
    setEditing(null); await refresh();
  };
  const count = connections.reduce((count, connection) => count + connectionRules(connection).length, 0);
  return <div className="ssh-forwarding-page" data-testid="port-forwarding-page">
    <header className="ssh-host-page-header"><nav aria-label={t('Page navigation')} className="ssh-host-page-title ssh-forwarding-breadcrumb"><button type="button" data-subtle onClick={() => useWorkspaceNavigation.getState().selectArea('ssh')}>{t('Hosts')}</button><ChevronRight size={18} aria-hidden="true" /><h2 aria-current="page">{t('Port forwarding')}</h2><span>{t('{{count}} rules', { count })}</span></nav><OutlineButton className="primary-button" disabled={!connections.length} onClick={() => setEditing({ connectionId: connections[0].id, rule: emptyRule(), create: true })}><Plus size={14} />{t('Add forward…')}</OutlineButton></header>
    <div className="ssh-forwarding-content scroll-region">
      {error && <ErrorBox title={t('Port forwarding failed')} details={error} onDismiss={() => setError('')} actions={<OutlineButton onClick={() => void refresh()}><RefreshCw size={14} />{t('Retry')}</OutlineButton>}>{t('Check the host credentials, network and listening port.')}</ErrorBox>}
      {!count && <div className="search-empty-state">{t(connections.length ? 'No forwarding rules. Add a rule to map a port.' : 'Create a saved host before adding a forwarding rule.')}</div>}
      {connections.map(connection => {
        const rules = connectionRules(connection);
        if (!rules.length) return null;
        return <section key={connection.id} className="ssh-forwarding-group"><h3>{connection.name}<span>{connection.user}@{connection.host}:{connection.port ?? 22}</span></h3><div className="ssh-forwarding-rules">
          {rules.map(rule => {
            const id = `${connection.id}/${rule.id}`;
            const status = statuses.find(status => status.id === id);
            return <div key={rule.id} className="ssh-forwarding-row" data-testid={`forward-rule-${rule.id}`}>
              <div className="ssh-forwarding-description">{rule.name && <strong>{rule.name}</strong>}<span className="ssh-forwarding-endpoints">{rule.kind === 'remote' && <span>{t('On server')}</span>}<code>{rule.bind}:{rule.port}</code>{rule.kind === 'dynamic' ? <span>{t('SOCKS proxy')}</span> : <><ArrowRight size={12} /><code>{rule.host}:{rule.targetPort}</code></>}</span>{status?.error && <span className="ssh-forwarding-rule-error" data-tip={status.error}>{t('Forwarding connection failed')}</span>}</div>
              <label className="ssh-forwarding-auto"><span>{t('Start on connect')}</span><Toggle compact label={t('Start {{name}} on connect', { name: rule.name || `${rule.bind}:${rule.port}` })} on={rule.autoStart} disabled={!!busy} onChange={value => void action(id, () => useSshStore.getState().save(withForwardingRules(connection, rules.map(item => item.id === rule.id ? { ...item, autoStart: value } : item))))} /></label>
              <OutlineButton className={status?.running ? 'ssh-forwarding-stop' : ''} disabled={!!busy} aria-busy={busy === id} onClick={() => void action(id, async () => {
                if (status?.running) await stopForwarding(connection.id, rule.id);
                else {
                  if (!connection.forwardingRules) await useSshStore.getState().save(withForwardingRules(connection, rules));
                  await startForwarding(connection.id, rule.id);
                }
              })}>{t(status?.running ? 'Stop forward' : 'Start forward')}</OutlineButton>
              <IconButton disabled={!!busy} aria-label={t('Edit forwarding rule')} data-tip={t('Edit forwarding rule')} onClick={() => setEditing({ connectionId: connection.id, rule, create: false })}><Pencil size={14} /></IconButton>
              <IconButton disabled={!!busy} aria-label={t('Delete forwarding rule')} data-tip={t('Delete forwarding rule')} onClick={() => setDeleting({ connection, rule })}><Trash2 size={14} /></IconButton>
            </div>;
          })}
        </div></section>;
      })}
    </div>
    {editing && <ForwardingDialog initial={editing.rule} connectionId={editing.connectionId} create={editing.create} connections={connections} onSave={save} onClose={() => setEditing(null)} />}
    {deleting && <ConfirmDialog open danger title={t('Delete forwarding rule?')} message={t('The rule will be stopped and removed from this host.')} confirmLabel={t('Delete')} cancelLabel={t('Cancel')} onCancel={() => setDeleting(null)} onConfirm={() => { const { connection, rule } = deleting; setDeleting(null); void action(rule.id, async () => { await stopForwarding(connection.id, rule.id); await useSshStore.getState().save(withForwardingRules(connection, connectionRules(connection).filter(item => item.id !== rule.id))); }); }} />}
  </div>;
}

function ForwardingDialog({ initial, connectionId, create, connections, onSave, onClose }: { initial: SshForwardingRule; connectionId: string; create: boolean; connections: SshConnection[]; onSave: (connectionId: string, rule: SshForwardingRule) => Promise<void>; onClose: () => void }) {
  const [rule, setRule] = useState(initial);
  const [hostId, setHostId] = useState(connectionId);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const saving = useRef(false);
  const close = () => { if (busy) return; if (JSON.stringify(rule) !== JSON.stringify(initial) || hostId !== connectionId) setDiscarding(true); else onClose(); };
  const save = async () => {
    if (saving.current) return;
    if (!rule.bind.trim() || !rule.host.trim() || !Number.isInteger(rule.port) || rule.port < 1 || rule.port > 65535 || rule.kind !== 'dynamic' && (!Number.isInteger(rule.targetPort) || rule.targetPort < 1 || rule.targetPort > 65535)) { setError(t('Enter valid addresses and ports from 1 to 65535.')); return; }
    saving.current = true; setBusy(true); setError('');
    try { await onSave(hostId, { ...rule, name: rule.name.trim(), bind: rule.bind.trim(), host: rule.host.trim() }); } catch (reason) { setError(String(reason)); } finally { saving.current = false; setBusy(false); }
  };
  useDialogKeyboard(dialog, true, { onClose: close, onSubmit: () => void save(), disabled: busy, initialFocus: '[data-testid="forward-name"]' });
  return createPortal(<div className="new-tab-overlay" onClick={close}><div ref={dialog} className="workspace-floating workspace-floating-dialog ssh-forwarding-dialog" role="dialog" aria-modal="true" aria-label={t(create ? 'Add port forward' : 'Edit port forward')} onClick={event => event.stopPropagation()}>
    <header><h2>{t(create ? 'Add port forward' : 'Edit port forward')}</h2><p>{t(rule.kind === 'local' ? 'A local port connects to an address reachable from the server.' : rule.kind === 'remote' ? 'A server port connects to an address reachable from this device.' : 'Create a local SOCKS5 proxy through this host.')}</p></header>
    <form noValidate className="ssh-forwarding-form scroll-region" onSubmit={event => { event.preventDefault(); void save(); }}>
      <div className="ssh-forwarding-fields">
        {create && <label>{t('Host')}<Select aria-label={t('Host')} value={hostId} onChange={setHostId} options={connections.map(connection => ({ value: connection.id, label: connection.name }))} /></label>}
        <label>{t('Name')}<TextInput variant="field" data-testid="forward-name" aria-label={t('Name')} value={rule.name} onChange={event => setRule({ ...rule, name: event.target.value })} /></label>
        <div className="ssh-forwarding-field"><span>{t('Type')}</span><Select aria-label={t('Forward type')} value={rule.kind} onChange={kind => setRule({ ...rule, kind })} options={[{ value: 'local', label: t('Local forward') }, { value: 'remote', label: t('Remote forward') }, { value: 'dynamic', label: t('Dynamic (SOCKS)') }]} /></div>
        <label>{t(rule.kind === 'remote' ? 'Server address' : 'Local address')}<span className="ssh-forwarding-address"><TextInput variant="field" aria-label={t('Listen address')} value={rule.bind} onChange={event => setRule({ ...rule, bind: event.target.value })} /><span>{t('Port')}</span><TextInput variant="field" aria-label={t('Listen port')} inputMode="numeric" value={rule.port || ''} onChange={event => setRule({ ...rule, port: Number(event.target.value) })} /></span></label>
        {rule.kind !== 'dynamic' && <label>{t('Destination address')}<span className="ssh-forwarding-address"><TextInput variant="field" aria-label={t('Destination address')} value={rule.host} onChange={event => setRule({ ...rule, host: event.target.value })} /><span>{t('Port')}</span><TextInput variant="field" aria-label={t('Destination port')} inputMode="numeric" value={rule.targetPort || ''} onChange={event => setRule({ ...rule, targetPort: Number(event.target.value) })} /></span></label>}
        <label className="ssh-forwarding-checkbox"><span /><span><Checkbox checked={rule.autoStart} onChange={event => setRule({ ...rule, autoStart: event.target.checked })} />{t('Start automatically when connecting to this host')}</span></label>
      </div>
      {error && <ErrorBox compact>{error}</ErrorBox>}
    </form>
    <footer><TextButton disabled={busy} onClick={close}>{t('Cancel')}</TextButton><TextButton className="user-primary-action" disabled={busy} onClick={() => void save()}>{t('Save')}</TextButton></footer>
    {discarding && <ConfirmDialog open title={t('Discard changes?')} confirmLabel={t('Discard')} cancelLabel={t('Keep editing')} onConfirm={onClose} onCancel={() => setDiscarding(false)} />}
  </div></div>, document.body);
}
