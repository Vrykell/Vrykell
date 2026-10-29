import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { createPortal } from 'react-dom';
import { TextArea, TextInput } from '@ui/fields/TextInput';
import { Checkbox } from '@ui/fields/Checkbox';
import { TextButton } from '@ui/actions/TextButton';
import { IconButton } from '@ui/actions/IconButton';
import Select from '@ui/fields/Select';
import SegmentedControl from '@ui/fields/SegmentedControl';
import TagInput from '@ui/fields/TagInput';
import SidebarItem from '@ui/layout/sidebarItem';
import KeyHint from '@ui/feedback/KeyHint';
import { useDialogKeyboard } from '@ui/hooks/useDialogKeyboard';
import { t } from '@i18n';
import { ArrowLeft, ChevronRight, GitBranch, iconSizes, Info, Key, Loader2, Lock, Plug, Plus, Server, Settings, Star, StarFilled, Trash2, X } from '@ui/icons';
import { IconBtn } from '@ui/actions/UiBtn';
import { isMacOS } from '@platform/runtime';
import { newSshId, validateSshConnection, sshTest, sshTrustHostKey, type SshConnection, type SshAuthMethod } from '../services/api';
import { useSshStore } from '@features/ssh';
import ConfirmDialog from '@ui/feedback/ConfirmDialog';
import ErrorBox from '@ui/feedback/ErrorBox';
import { open as chooseFile } from '@tauri-apps/plugin-dialog';
import SshForwardingEditor from './SshForwardingEditor';
import { forwardLines, type ForwardTexts } from '../model/forwardRules';
import './SshConnection.css';
import { EMPTY_HOST_METADATA, useHostLibrary } from '../stores/hostLibrary';
import { tagColor } from '../model/hostTags';
import ProxyManager from './ProxyManager';
import { getProxies, type ProxyConfiguration } from '../services/proxies';

interface Props {
  open: boolean;
  initial: SshConnection | null;
  onClose: () => void;
  onConnect?: (connection: SshConnection) => void;
  onSaved?: (connection: SshConnection) => void;
  onSaveAndConnect?: (connection: SshConnection) => void;
  page?: boolean;
}
type Section = 'connection' | 'forwarding' | 'advanced';
const sectionIcons = { connection: Server, forwarding: GitBranch, advanced: Settings };
const list = (text: string) => { const rows = forwardLines(text); return rows.length ? rows : undefined; };

function FormSection({ title, children, ...props }: ComponentProps<'section'>) {
  return <section className="ssh-form-section" {...props}>
    {title && <h3>{title}</h3>}
    <div className="ssh-form-section-fields">{children}</div>
  </section>;
}

/** Edit a profile in focused sections while retaining its drafts across section changes. */
export default function SshFormModal({ open, initial, onClose, onConnect, onSaved, onSaveAndConnect, page = false }: Props) {
  const save = useSshStore(s => s.save);
  const remove = useSshStore(s => s.remove);
  const dialog = useRef<HTMLDivElement>(null);
  const savingRef = useRef(false);
  const [section, setSection] = useState<Section>('connection');
  const [version, setVersion] = useState(0);
  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const [user, setUser] = useState('');
  const [authMethod, setAuthMethod] = useState<SshAuthMethod>('password');
  const [password, setPassword] = useState('');
  const [identityFile, setIdentityFile] = useState('');
  const [jumpHost, setJumpHost] = useState('');
  const [keepalive, setKeepalive] = useState('30');
  const [shellIntegration, setShellIntegration] = useState(false);
  const [forwards, setForwards] = useState<ForwardTexts>({ local: '', remote: '', dynamic: '' });
  const [autoReconnect, setAutoReconnect] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [pendingTrust, setPendingTrust] = useState<{ host: string; port?: number; fingerprint: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const metadata = useHostLibrary(state => state.hosts);
  const [group, setGroup] = useState('');
  const [addingGroup, setAddingGroup] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [starred, setStarred] = useState(false);
  const [proxyId, setProxyId] = useState('default');
  const [proxies, setProxies] = useState<ProxyConfiguration>({ profiles: [], defaultId: null });
  const [proxyManager, setProxyManager] = useState(false);
  const [environment, setEnvironment] = useState<{ name: string; value: string }[]>([{ name: '', value: '' }]);
  const [notes, setNotes] = useState('');
  const [aiNotes, setAiNotes] = useState('');
  const groups = [...new Set(Object.values(metadata).map(value => value.group).filter(Boolean))].sort();
  const knownTags = [...new Set([...Object.values(metadata).flatMap(value => value.tags), ...tags])].sort();
  useEffect(() => {
    if (!open) return;
    setSection('connection'); setName(initial?.name ?? ''); setHost(initial?.host ?? '');
    setPort(initial?.port ? String(initial.port) : ''); setUser(initial?.user ?? '');
    setAuthMethod(initial?.authMethod ?? 'password'); setPassword('');
    setIdentityFile(initial?.identityFile ?? ''); setJumpHost(initial?.jumpHost ?? '');
    setKeepalive(String(initial?.serverAliveInterval ?? 30));
    setShellIntegration(initial ? initial.shellIntegration ?? true : false);
    setForwards({ local: (initial?.localForwards ?? []).join('\n'), remote: (initial?.remoteForwards ?? []).join('\n'), dynamic: (initial?.dynamicForwards ?? []).join('\n') });
    setAutoReconnect(initial?.autoReconnect ?? false); setTestResult(null); setPendingTrust(null);
    setError(''); setDeleting(false); setVersion(value => value + 1);
    const meta = initial ? useHostLibrary.getState().hosts[initial.id] ?? EMPTY_HOST_METADATA : EMPTY_HOST_METADATA;
    setGroup(meta.group); setAddingGroup(false); setTags(meta.tags); setStarred(meta.starred);
    const variables = Object.entries(initial?.environment ?? {}).map(([name, value]) => ({ name, value }));
    setProxyId(initial?.proxyId ?? 'default'); setEnvironment(variables.length ? variables : [{ name: '', value: '' }]);
    setNotes(initial?.notes ?? ''); setAiNotes(initial?.aiNotes ?? '');
  }, [open, initial]);
  useEffect(() => {
    if (!open) return;
    let disposed = false;
    void getProxies().then(config => { if (!disposed) setProxies(config); }).catch(reason => { if (!disposed) setError(String(reason)); });
    return () => { disposed = true; };
  }, [open]);
  useEffect(() => {
    if (!page || !(error || testResult)) return;
    const frame = requestAnimationFrame(() => dialog.current?.querySelector('[data-testid="ssh-test-result"]')?.scrollIntoView?.({ block: 'nearest' }));
    return () => cancelAnimationFrame(frame);
  }, [page, error, testResult]);
  const target = () => ({
    forwardingRules: initial?.forwardingRules,
    host: host.trim(), port: port.trim() ? Number(port) : 22, user: user.trim(),
    password: authMethod === 'password' ? password : '', identityFile: authMethod === 'key' ? identityFile.trim() || undefined : undefined,
    jumpHost: jumpHost.trim() || undefined, serverAliveInterval: keepalive.trim() ? Number(keepalive) : 30, shellIntegration,
    localForwards: list(forwards.local), remoteForwards: list(forwards.remote), dynamicForwards: list(forwards.dynamic), autoReconnect,
    proxyId: proxyId === 'default' ? undefined : proxyId, environment: Object.fromEntries(environment.filter(row => row.name.trim() || row.value).map(row => [row.name.trim(), row.value])),
    notes, aiNotes, authenticationMode: authMethod,
  });
  const validateEnvironment = () => {
    const populated = environment.filter(row => row.name.trim() || row.value);
    if (populated.length > 64 || new Set(populated.map(row => row.name.trim())).size !== populated.length) return t('Environment variable names must be unique; up to 64 variables are supported.');
    return null;
  };
  const doSave = async (connect = false) => {
    if (savingRef.current) return;
    const conn: SshConnection = { id: initial?.id ?? newSshId(), ...target(), authMethod,
      name: name.trim() || `${user.trim() ? `${user.trim()}@` : ''}${host.trim()}`,
    };
    const invalid = validateEnvironment() || validateSshConnection(conn);
    if (invalid) {
      setError(invalid);
      const forwardingError = validateSshConnection({ name: 'validation', host: 'localhost', localForwards: conn.localForwards, remoteForwards: conn.remoteForwards, dynamicForwards: conn.dynamicForwards });
      const baseError = validateSshConnection({ name: conn.name, host: conn.host, port: conn.port, user: conn.user, identityFile: conn.identityFile });
      setSection(baseError ? 'connection' : forwardingError ? 'forwarding' : 'advanced');
      if (page && forwardingError) dialog.current?.querySelector('details')?.setAttribute('open', '');
      return;
    }
    savingRef.current = true; setSaving(true); setError('');
    try {
      if (onConnect) onConnect(conn);
      else { await save(conn); useHostLibrary.getState().update(conn.id, { group: group.trim(), tags, starred }); onSaved?.(conn); if (connect) onSaveAndConnect?.(conn); }
      onClose();
    } catch (reason) { setError(String((reason as Error)?.message ?? reason)); }
    finally { savingRef.current = false; setSaving(false); }
  };
  useDialogKeyboard(dialog, open && !page, { onClose, onSubmit: () => { void doSave(); }, disabled: saving || testing, initialFocus: onConnect ? '[data-testid="ssh-form-host"]' : '[data-testid="ssh-form-name"]' });
  const doTest = async () => {
    if (testing) return;
    const draft = target();
    const invalid = validateEnvironment() || validateSshConnection({ ...draft, name: name.trim() || draft.host });
    if (invalid) { setError(invalid); return; }
    if (draft.jumpHost && draft.jumpHost.toLowerCase() !== 'none') {
      setTestResult({ ok: false, msg: t('Jump-host authentication must be completed in the terminal. Save and connect to continue.') }); return;
    }
    if (initial?.hasPassword && authMethod === 'password' && !password) {
      setTestResult({ ok: false, msg: t('Enter the password to test authentication. Saving an empty password keeps the stored password.') }); return;
    }
    setTesting(true); setTestResult(null); setError('');
    try {
      await sshTest(draft);
      setTestResult({ ok: true, msg: t('Authentication succeeded. Terminal, port forwarding and SFTP availability have not been tested.') });
    } catch (reason) {
      const msg = String((reason as Error)?.message ?? reason);
      if (msg.startsWith('HOST_KEY_UNKNOWN:')) setPendingTrust({ host: draft.host, port: draft.port, fingerprint: msg.slice('HOST_KEY_UNKNOWN:'.length) });
      else setTestResult({ ok: false, msg });
    } finally { setTesting(false); }
  };
  const confirmTrust = async () => {
    if (!pendingTrust) return;
    try { await sshTrustHostKey(pendingTrust.host, pendingTrust.port, pendingTrust.fingerprint, target()); setPendingTrust(null); void doTest(); }
    catch (reason) { setPendingTrust(null); setError(String((reason as Error)?.message ?? reason)); }
  };
  const doDelete = async () => {
    if (!initial) return;
    try { await remove(initial.id); onClose(); }
    catch (reason) { setDeleting(false); setError(String((reason as Error)?.message ?? reason)); }
  };
  if (!open) return null;
  const busy = saving || testing;
  const feedback = (error || testResult) && <div className="ssh-inline-error"><ErrorBox compact tone={error || !testResult?.ok ? 'error' : 'success'} testId="ssh-test-result">{t(error || testResult?.msg || '')}</ErrorBox></div>;
  const deleteButton = initial && <TextButton className="ssh-editor-delete" onClick={() => setDeleting(true)} disabled={busy} data-testid="ssh-delete-btn"><Trash2 size={13} />{t('Delete')}</TextButton>;
  const footer = <footer className="ssh-form-footer">
    {!page && deleteButton}
    {!onConnect && <TextButton onClick={() => void doTest()} disabled={busy} data-testid="ssh-test-btn">{testing ? <Loader2 size={13} className="spin" /> : <Plug size={13} />}{t(testing ? 'Testing…' : 'Test authentication')}</TextButton>}
    <span style={{ flex: 1 }} />
    {!page && <TextButton onClick={onClose} disabled={busy}>{t('Cancel')}</TextButton>}
    {!onConnect && onSaveAndConnect && <TextButton onClick={() => void doSave(true)} disabled={busy} data-testid="ssh-save-connect-btn">{t('Save and connect')}</TextButton>}
    {page && deleteButton}
    {!page && <TextButton className="ssh-primary-action user-primary-action" onClick={() => void doSave()} disabled={busy} data-testid={onConnect ? 'ssh-connect-btn' : 'ssh-save-btn'}>{t(saving ? 'Saving…' : onConnect ? 'Connect' : 'Save')}</TextButton>}
  </footer>;
  const content = <>
    <div ref={dialog} className={page ? 'ssh-host-editor' : `workspace-floating workspace-floating-dialog ssh-form-dialog${onConnect ? ' ssh-host-editor ssh-quick-connect' : ''}`} data-testid={page ? 'ssh-host-editor' : undefined} role={page ? 'region' : 'dialog'} aria-modal={page ? undefined : true} aria-label={t('SSH connection')} tabIndex={-1} onClick={event => event.stopPropagation()} onKeyDown={event => {
      if (page && (event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); if (!busy) void doSave(); }
    }}>
      <header className="ssh-form-header">{page ? <>
        <IconBtn title={t('Back to hosts')} disabled={busy} onClick={onClose}><ArrowLeft size={18} /></IconBtn><span className="ssh-editor-breadcrumb">{group || t('All hosts')}<span>/</span><strong>{name || t(initial ? 'Edit SSH connection' : 'New host')}</strong></span>
        <IconButton data-subtle className="ssh-editor-favorite" disabled={busy} aria-label={t(starred ? 'Unstar host' : 'Star host')} aria-pressed={starred} onClick={() => setStarred(value => !value)}>{starred ? <StarFilled size={18} color="var(--favorite-color)" /> : <Star size={18} />}</IconButton>
        <TextButton disabled={busy} onClick={onClose}>{t('Cancel')}</TextButton><TextButton className="user-primary-action" disabled={busy} onClick={() => void doSave()} data-testid="ssh-save-btn">{t(saving ? 'Saving…' : 'Save')}</TextButton>
      </> : <><h2>{t(onConnect ? 'Quick SSH connection' : initial ? 'Edit SSH connection' : 'New SSH connection')}</h2><KeyHint shortcut={isMacOS ? 'Meta+Enter' : 'Control+Enter'} /></>}</header>
      <div className="ssh-form-layout">
        {!page && !onConnect && <nav className="ssh-form-nav" role="tablist" aria-label={t('Connection options')} onKeyDown={event => {
          const ids: Section[] = ['connection', 'forwarding', 'advanced'];
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const index = ids.indexOf(section);
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (index + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? 2 : 1)) % 3;
          setSection(ids[next]); event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
        }}>
          {(['connection', 'forwarding', 'advanced'] as const).map(id => {
            const Icon = sectionIcons[id];
            return <SidebarItem key={id} icon={<Icon size={iconSizes.row} />} compact
            active={section === id} title={t(id === 'connection' ? 'Connection' : id === 'forwarding' ? 'Port forwarding' : 'Advanced')}
            tabIndex={section === id ? 0 : -1} testId={`ssh-section-tab-${id}`} onClick={() => setSection(id)}
            dataAttributes={{ role: 'tab', 'aria-selected': String(section === id), 'aria-controls': `ssh-section-${id}` }}
            onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSection(id); } }}
            style={{ fontSize: 'var(--fs-label)', flexShrink: 0 }} />;
          })}
        </nav>}
        <div className="ssh-form-body scroll-region" data-testid="ssh-form-body">
          <FormSection title={t('Basic information')} id="ssh-section-connection" role={page || onConnect ? undefined : 'tabpanel'} aria-label={t('Connection')} hidden={!page && !onConnect && section !== 'connection'}>
            <label>{t(onConnect ? 'Connection name (optional)' : 'Connection name')}<TextInput variant="field" autoFocus={page} value={name} placeholder={t('Production server')} onChange={e => setName(e.target.value)} data-testid="ssh-form-name" /></label>
            <div className="ssh-form-fields">
              <label>{t('Host (IP / domain)')}<TextInput variant="field" value={host} placeholder="192.168.1.10" onChange={e => setHost(e.target.value)} data-testid="ssh-form-host" /></label>
              <label>{t('Port')}<TextInput variant="field" value={port} placeholder="22" inputMode="numeric" onChange={e => setPort(e.target.value)} data-testid="ssh-form-port" /></label>
            </div>
            <label>{t('Account')}<TextInput variant="field" value={user} placeholder={t('Use local account when empty')} onChange={e => setUser(e.target.value)} data-testid="ssh-form-user" /></label>
          </FormSection>
          <FormSection title={t('Authentication')} hidden={!page && !onConnect && section !== 'connection'}>
            <div className="ssh-editor-field-row"><span>{t('Authentication method')}</span><SegmentedControl label={t('Authentication method')} value={authMethod} onChange={setAuthMethod} options={[
              { value: 'password', label: t('Password'), icon: <Lock size={14} /> }, { value: 'key', label: t('Private key'), icon: <Key size={14} /> },
              { value: 'ask', label: t('Ask every time'), icon: <Info size={14} /> }, { value: 'agent', label: 'SSH Agent', icon: <Server size={14} /> },
            ]} /></div>
            {authMethod === 'password' ? (
              <label>{t('Password')}<TextInput variant="field" type="password" value={password} placeholder={initial?.hasPassword ? t('Leave empty to keep the stored password') : '••••••'} onChange={e => setPassword(e.target.value)} data-testid="ssh-form-password" /></label>
            ) : authMethod === 'key' ? (
              <label>{t('Private key file (optional)')}
                <div className="ssh-form-file-picker">
                  <TextInput variant="field" value={identityFile} onChange={e => setIdentityFile(e.target.value)} data-testid="ssh-form-identity" placeholder={t('Use default keys / SSH Agent when empty')} style={{ flex: '1 1 0', minWidth: 0, width: 0 }} />
                  <TextButton className="ssh-form-browse" onClick={async () => {
                    try {
                      const path = await chooseFile({ multiple: false, directory: false, title: t('Choose SSH private key') });
                      if (typeof path === 'string') setIdentityFile(path);
                    } catch (reason) { setError(String(reason)); }
                  }}>{t('Browse…')}</TextButton>
                </div>
              </label>
            ) : <p>{t(authMethod === 'ask' ? 'Enter credentials interactively when connecting.' : 'Use identities provided by the SSH authentication agent.')}</p>}
          </FormSection>
          <FormSection title={t('Organization and network')} id="ssh-section-organization" hidden={!page && !onConnect && section !== 'advanced'}>
            <label>{t('Host group')}<div className="ssh-editor-pair ssh-editor-group">{addingGroup ? <><TextInput variant="field" autoFocus aria-label={t('Host group')} placeholder={t('New group (optional)')} value={group} onChange={event => setGroup(event.target.value)} data-testid="ssh-form-group" onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); setAddingGroup(false); } }} /><TextButton onClick={() => setAddingGroup(false)}>{t('Done')}</TextButton></> : <Select aria-label={t('Existing groups')} value={group} options={[{ value: '', label: t('Ungrouped') }, ...[...new Set([...groups, group].filter(Boolean))].map(value => ({ value, label: value }))]} onChange={setGroup} action={{ label: t('New group…'), onSelect: () => setAddingGroup(true) }} />}</div></label>
            <div className="ssh-editor-field-row"><span>{t('Host tags')}</span><TagInput value={tags} options={knownTags.map(value => ({ value, color: tagColor(value) }))} onChange={setTags} inputTestId="ssh-form-tag" /></div>
            <label>{t('Jump host (optional)')}<div className="ssh-editor-network"><TextInput variant="field" value={jumpHost} onChange={e => setJumpHost(e.target.value)} data-testid="ssh-form-jump" placeholder="user@host:port" data-tip={t('Separate multiple jump hosts with commas. Use none to disable inherited jump hosts.')} /><small>{t('Route the connection through a jump host (ProxyJump).')}</small></div></label>
            <label>{t('Proxy')}<div className="ssh-editor-pair ssh-editor-proxy"><Select aria-label={t('Proxy')} value={proxyId} options={[{ value: 'default', label: t('Device default') }, { value: 'none', label: t('No proxy') }, ...proxies.profiles.map(profile => ({ value: profile.id, label: profile.name })), ...(!['default', 'none'].includes(proxyId) && !proxies.profiles.some(profile => profile.id === proxyId) ? [{ value: proxyId, label: t('Unavailable proxy') }] : [])]} onChange={setProxyId} /><TextButton className="ssh-editor-link" onClick={() => setProxyManager(true)}>{t('Manage proxies')}</TextButton></div></label>
          </FormSection>
          <FormSection title={t('Environment variables')} hidden={!page && !onConnect && section !== 'advanced'}>
            <div className="ssh-environment-rows">{environment.map((row, index) => <div key={index} className="ssh-editor-pair"><TextInput variant="field" aria-label={t('Variable name')} placeholder={t('Variable name')} value={row.name} data-testid={`ssh-env-name-${index}`} onChange={event => setEnvironment(current => current.map((value, position) => position === index ? { ...value, name: event.target.value } : value))} /><span>=</span><TextInput variant="field" aria-label={t('Variable value')} placeholder={t('Value')} value={row.value} data-testid={`ssh-env-value-${index}`} onChange={event => setEnvironment(current => current.map((value, position) => position === index ? { ...value, value: event.target.value } : value))} /><IconBtn title={t('Remove variable')} onClick={() => setEnvironment(current => current.filter((_, position) => position !== index))}><X size={16} /></IconBtn></div>)}</div>
            <TextButton className="ssh-editor-link" disabled={environment.length >= 64} onClick={() => setEnvironment(current => [...current, { name: '', value: '' }])} data-testid="ssh-env-add"><Plus size={14} />{t('Add variable')}</TextButton>
          </FormSection>
          {(page || onConnect || section === 'advanced') && <p className="ssh-editor-section-hint">{t('The server must allow these variables through AcceptEnv. Do not store secrets here.')}</p>}
          <section className="ssh-editor-note" hidden={!page && !onConnect && section !== 'advanced'}>
            <label htmlFor="ssh-host-notes">{t('Notes')}</label><TextArea variant="field" id="ssh-host-notes" value={notes} rows={3} onChange={event => setNotes(event.target.value)} data-testid="ssh-form-notes" />
          </section>
          <section className="ssh-editor-note" hidden={!page && !onConnect && section !== 'advanced'}>
            <label htmlFor="ssh-host-ai-notes">{t('AI notes')}</label><p>{t('Included in AI requests connected to this host. Do not include passwords or other secrets.')}</p>
            <TextArea variant="field" id="ssh-host-ai-notes" value={aiNotes} rows={4} onChange={event => setAiNotes(event.target.value)} data-testid="ssh-form-ai-notes" /><small>{new TextEncoder().encode(aiNotes).length.toLocaleString()} / 16,384 {t('bytes')}</small>
          </section>
          <details className="ssh-editor-advanced" open={page ? undefined : true}>
            <summary hidden={!page}><ChevronRight size={14} />{t('Advanced connection options')}</summary>
          <FormSection id="ssh-section-forwarding" role={page || onConnect ? undefined : 'tabpanel'} aria-label={t('Port forwarding')} hidden={!page && !onConnect && section !== 'forwarding'}>
            <SshForwardingEditor key={version} value={forwards} onChange={setForwards} />
          </FormSection>
          <FormSection title={t('Connection behavior')} id="ssh-section-advanced" role={page || onConnect ? undefined : 'tabpanel'} aria-label={t('Advanced')} hidden={!page && !onConnect && section !== 'advanced'}>
            <div className="ssh-form-fields">
              <label>{t('Keepalive interval (seconds)')}<TextInput variant="field" type="number" min={0} max={3600} value={keepalive} onChange={e => setKeepalive(e.target.value)} data-testid="ssh-form-keepalive" /></label>
            </div>
            <div className="ssh-check-group">
              <label className="ssh-check-row"><Checkbox checked={shellIntegration} onChange={e => setShellIntegration(e.target.checked)} data-testid="ssh-form-integration" /><span>{t('Enable remote Shell integration (command blocks)')}<small>{t('Leave this off for menu-based servers. Enable it for shells that support command blocks.')}</small></span></label>
              <label className="ssh-check-row"><Checkbox checked={autoReconnect} onChange={e => setAutoReconnect(e.target.checked)} data-testid="ssh-form-auto-reconnect" /><span>{t('Reconnect automatically after a drop')}<small>{t('Retry up to 5 times with backoff. Clean exits and manual disconnects are not retried.')}</small></span></label>
            </div>
          </FormSection>
          </details>
          {page && feedback}
          {page && footer}
        </div>
      </div>
      {!page && feedback}
      {!page && footer}
    </div>
    {pendingTrust && <ConfirmDialog open title={t('Confirm host fingerprint')} message={pendingTrust.fingerprint} confirmLabel={t('Trust and continue')} cancelLabel={t('Cancel')} onConfirm={() => void confirmTrust()} onCancel={() => setPendingTrust(null)} />}
    {deleting && <ConfirmDialog open danger title={t('Delete SSH connection?')} message={initial?.name} confirmLabel={t('Delete')} cancelLabel={t('Cancel')} onConfirm={() => void doDelete()} onCancel={() => setDeleting(false)} />}
    {proxyManager && <ProxyManager config={proxies} onChange={setProxies} onClose={() => setProxyManager(false)} />}
  </>;
  return page ? content : createPortal(<div style={{ position: 'fixed', inset: 0, zIndex: 9996, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--overlay)' }} onClick={() => { if (!busy) onClose(); }}>{content}</div>, document.body);
}
