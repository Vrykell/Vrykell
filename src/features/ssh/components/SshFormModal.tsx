import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { TextInput } from '@ui/TextInput';
import { Checkbox } from '@ui/Checkbox';
import { TextButton } from '@ui/TextButton';
import Select from '@ui/Select';
import SidebarItem from '@ui/sidebarItem';
import KeyHint from '@ui/KeyHint';
import { useDialogKeyboard } from '@ui/useDialogKeyboard';
import { t } from '@i18n';
import { GitBranch, iconSizes, Loader2, Plug, Server, Settings, Trash2 } from '@ui/icons';
import { isMacOS } from '@platform/runtime';
import { newSshId, validateSshConnection, sshTest, sshTrustHostKey, type SshConnection, type SshAuthMethod } from '../services/api';
import { useSshStore } from '@features/ssh';
import ConfirmDialog from '@ui/ConfirmDialog';
import ErrorBox from '@ui/ErrorBox';
import { open as chooseFile } from '@tauri-apps/plugin-dialog';
import SshForwardingEditor from './SshForwardingEditor';
import { forwardLines, type ForwardTexts } from '../model/forwardRules';
import './SshConnection.css';

interface Props {
  open: boolean;
  initial: SshConnection | null;
  onClose: () => void;
  onConnect?: (connection: SshConnection) => void;
  onSaved?: (connection: SshConnection) => void;
  onSaveAndConnect?: (connection: SshConnection) => void;
}
type Section = 'connection' | 'forwarding' | 'advanced';
const sectionIcons = { connection: Server, forwarding: GitBranch, advanced: Settings };
const list = (text: string) => { const rows = forwardLines(text); return rows.length ? rows : undefined; };

/** Edit a profile in focused sections while retaining its drafts across section changes. */
export default function SshFormModal({ open, initial, onClose, onConnect, onSaved, onSaveAndConnect }: Props) {
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
  }, [open, initial]);
  const target = () => ({
    host: host.trim(), port: port.trim() ? Number(port) : undefined, user: user.trim(),
    password: authMethod === 'password' ? password : '', identityFile: authMethod === 'key' ? identityFile.trim() || undefined : undefined,
    jumpHost: jumpHost.trim() || undefined, serverAliveInterval: Number(keepalive), shellIntegration,
    localForwards: list(forwards.local), remoteForwards: list(forwards.remote), dynamicForwards: list(forwards.dynamic), autoReconnect,
  });
  const doSave = async (connect = false) => {
    if (savingRef.current) return;
    const conn: SshConnection = { id: initial?.id ?? newSshId(), ...target(), authMethod,
      name: name.trim() || (onConnect ? `${user.trim() ? `${user.trim()}@` : ''}${host.trim()}` : ''),
    };
    const invalid = validateSshConnection(conn);
    if (invalid) {
      setError(invalid);
      const forwardingError = validateSshConnection({ name: 'validation', host: 'localhost', localForwards: conn.localForwards, remoteForwards: conn.remoteForwards, dynamicForwards: conn.dynamicForwards });
      const baseError = validateSshConnection({ name: conn.name, host: conn.host, port: conn.port, user: conn.user, identityFile: conn.identityFile });
      setSection(baseError ? 'connection' : forwardingError ? 'forwarding' : 'advanced');
      return;
    }
    savingRef.current = true; setSaving(true); setError('');
    try {
      if (onConnect) onConnect(conn);
      else { await save(conn); onSaved?.(conn); if (connect) onSaveAndConnect?.(conn); }
      onClose();
    } catch (reason) { setError(String((reason as Error)?.message ?? reason)); }
    finally { savingRef.current = false; setSaving(false); }
  };
  useDialogKeyboard(dialog, open, { onClose, onSubmit: () => { void doSave(); }, disabled: saving || testing, initialFocus: onConnect ? '[data-testid="ssh-form-host"]' : '[data-testid="ssh-form-name"]' });
  const doTest = async () => {
    if (testing) return;
    const draft = target();
    const invalid = validateSshConnection({ ...draft, name: name.trim() || draft.host });
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
    try { await sshTrustHostKey(pendingTrust.host, pendingTrust.port, pendingTrust.fingerprint); setPendingTrust(null); void doTest(); }
    catch (reason) { setPendingTrust(null); setError(String((reason as Error)?.message ?? reason)); }
  };
  const doDelete = async () => {
    if (!initial) return;
    try { await remove(initial.id); onClose(); }
    catch (reason) { setDeleting(false); setError(String((reason as Error)?.message ?? reason)); }
  };
  if (!open) return null;
  const busy = saving || testing;
  // Portal to the body: the panel stacking context must never cover the centered dialog.
  return createPortal(<div style={{ position: 'fixed', inset: 0, zIndex: 9996, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--overlay)' }} onClick={() => { if (!busy) onClose(); }}>
    <div ref={dialog} className="workspace-floating workspace-floating-dialog ssh-form-dialog" role="dialog" aria-modal="true" aria-label={t('SSH connection')} tabIndex={-1} onClick={event => event.stopPropagation()}>
      <header className="ssh-form-header"><h2>{t(onConnect ? 'Quick SSH connection' : initial ? 'Edit SSH connection' : 'New SSH connection')}</h2><KeyHint shortcut={isMacOS ? 'Meta+Enter' : 'Control+Enter'} /></header>
      <div className="ssh-form-layout">
        <nav className="ssh-form-nav" role="tablist" aria-label={t('Connection options')} onKeyDown={event => {
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
        </nav>
        <div className="ssh-form-body scroll-region" data-testid="ssh-form-body">
          <section className="ssh-form-section" id="ssh-section-connection" role="tabpanel" aria-label={t('Connection')} hidden={section !== 'connection'}>
            <div><h3>{t('Connection and authentication')}</h3><p>{t('Enter the server address and choose how to authenticate.')}</p></div>
            <label>{t(onConnect ? 'Connection name (optional)' : 'Connection name')}<TextInput value={name} placeholder={t('Production server')} onChange={e => setName(e.target.value)} data-testid="ssh-form-name" /></label>
            <div className="ssh-form-fields">
              <label>{t('Host (IP / domain)')}<TextInput value={host} placeholder="192.168.1.10" onChange={e => setHost(e.target.value)} data-testid="ssh-form-host" /></label>
              <label>{t('Port')}<TextInput value={port} placeholder="22" inputMode="numeric" onChange={e => setPort(e.target.value)} data-testid="ssh-form-port" /></label>
              <label>{t('Account')}<TextInput value={user} placeholder="root" onChange={e => setUser(e.target.value)} data-testid="ssh-form-user" /></label>
              <label>{t('Authentication method')}<Select aria-label={t('Authentication method')} value={authMethod} onChange={value => setAuthMethod(value as SshAuthMethod)} options={[{ value: 'password', label: t('Password') }, { value: 'key', label: t('Private key / SSH Agent') }]} /></label>
            </div>
            {authMethod === 'password' ? (
              <label>{t('Password')}<TextInput type="password" value={password} placeholder={initial?.hasPassword ? t('Leave empty to keep the stored password') : '••••••'} onChange={e => setPassword(e.target.value)} data-testid="ssh-form-password" /></label>
            ) : (
              <label>{t('Private key file (optional)')}
                <div className="ssh-form-file-picker">
                  <TextInput value={identityFile} onChange={e => setIdentityFile(e.target.value)} data-testid="ssh-form-identity" placeholder={t('Use default keys / SSH Agent when empty')} style={{ flex: '1 1 0', minWidth: 0, width: 0 }} />
                  <TextButton className="ssh-form-browse" onClick={async () => {
                    try {
                      const path = await chooseFile({ multiple: false, directory: false, title: t('Choose SSH private key') });
                      if (typeof path === 'string') setIdentityFile(path);
                    } catch (reason) { setError(String(reason)); }
                  }}>{t('Browse…')}</TextButton>
                </div>
              </label>
            )}
            <p>{t('Authentication testing checks host trust and credentials. Use a terminal connection to verify interactive access.')}</p>
          </section>
          <section className="ssh-form-section" id="ssh-section-forwarding" role="tabpanel" aria-label={t('Port forwarding')} hidden={section !== 'forwarding'}>
            <SshForwardingEditor key={version} value={forwards} onChange={setForwards} />
          </section>
          <section className="ssh-form-section" id="ssh-section-advanced" role="tabpanel" aria-label={t('Advanced')} hidden={section !== 'advanced'}>
            <div><h3>{t('Connection behavior')}</h3><p>{t('Configure jump hosts, keepalive and recovery independently of the connection address.')}</p></div>
            <div className="ssh-form-fields">
              <label>{t('Jump host (optional)')}<TextInput value={jumpHost} onChange={e => setJumpHost(e.target.value)} data-testid="ssh-form-jump" placeholder="user@host:port" data-tip={t('Separate multiple jump hosts with commas. Use none to disable inherited jump hosts.')} /></label>
              <label>{t('Keepalive interval (seconds)')}<TextInput type="number" min={0} max={3600} value={keepalive} onChange={e => setKeepalive(e.target.value)} data-testid="ssh-form-keepalive" /></label>
            </div>
            <div className="ssh-check-group">
              <label className="ssh-check-row"><Checkbox checked={shellIntegration} onChange={e => setShellIntegration(e.target.checked)} data-testid="ssh-form-integration" /><span>{t('Enable remote Shell integration (command blocks)')}<small>{t('Leave this off for menu-based servers. Enable it for shells that support command blocks.')}</small></span></label>
              <label className="ssh-check-row"><Checkbox checked={autoReconnect} onChange={e => setAutoReconnect(e.target.checked)} data-testid="ssh-form-auto-reconnect" /><span>{t('Reconnect automatically after a drop')}<small>{t('Retry up to 5 times with backoff. Clean exits and manual disconnects are not retried.')}</small></span></label>
            </div>
          </section>
        </div>
      </div>
      {(error || testResult) && <div className="ssh-inline-error"><ErrorBox compact tone={error || !testResult?.ok ? 'error' : 'success'} testId="ssh-test-result">{error || testResult?.msg}</ErrorBox></div>}
      <footer className="ssh-form-footer">
        {initial && <TextButton onClick={() => setDeleting(true)} disabled={busy} data-testid="ssh-delete-btn"><Trash2 size={13} />{t('Delete')}</TextButton>}
        {!onConnect && <TextButton onClick={() => void doTest()} disabled={busy} data-testid="ssh-test-btn">{testing ? <Loader2 size={13} className="spin" /> : <Plug size={13} />}{t(testing ? 'Testing…' : 'Test authentication')}</TextButton>}
        <span style={{ flex: 1 }} />
        <TextButton onClick={onClose} disabled={busy}>{t('Cancel')}</TextButton>
        {!onConnect && onSaveAndConnect && <TextButton onClick={() => void doSave(true)} disabled={busy} data-testid="ssh-save-connect-btn">{t('Save and connect')}</TextButton>}
        <TextButton className="ssh-primary-action user-primary-action" onClick={() => void doSave()} disabled={busy} data-testid={onConnect ? 'ssh-connect-btn' : 'ssh-save-btn'}>{t(saving ? 'Saving…' : onConnect ? 'Connect' : 'Save')}</TextButton>
      </footer>
    </div>
    {pendingTrust && <ConfirmDialog open title={t('Confirm host fingerprint')} message={pendingTrust.fingerprint} confirmLabel={t('Trust and continue')} cancelLabel={t('Cancel')} onConfirm={() => void confirmTrust()} onCancel={() => setPendingTrust(null)} />}
    {deleting && <ConfirmDialog open danger title={t('Delete SSH connection?')} message={initial?.name} confirmLabel={t('Delete')} cancelLabel={t('Cancel')} onConfirm={() => void doDelete()} onCancel={() => setDeleting(false)} />}
  </div>, document.body);
}
