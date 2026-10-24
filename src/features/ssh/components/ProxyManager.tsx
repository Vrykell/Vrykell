import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { t } from '@i18n';
import { TextInput } from '@ui/TextInput';
import { TextButton } from '@ui/TextButton';
import Select from '@ui/Select';
import ErrorBox from '@ui/ErrorBox';
import ConfirmDialog from '@ui/ConfirmDialog';
import { useDialogKeyboard } from '@ui/useDialogKeyboard';
import { deleteProxy, getProxies, saveProxy, setDefaultProxy, type ProxyConfiguration, type ProxyProfile } from '../services/proxies';

const emptyProfile = (): ProxyProfile => ({ id: `proxy-${crypto.randomUUID()}`, name: '', kind: 'socks5', host: '', port: 1080, username: '', password: '' });
export default function ProxyManager({ config, onChange, onClose }: { config: ProxyConfiguration; onChange: (config: ProxyConfiguration) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(emptyProfile);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const action = async (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError('');
    try { await operation(); onChange(await getProxies()); }
    catch (reason) { setError(t(reason instanceof Error ? reason.message : String(reason))); }
    finally { setBusy(false); }
  };
  const save = () => action(async () => {
    if (!draft.name.trim() || !draft.host.trim() || !Number.isInteger(draft.port) || draft.port < 1 || draft.port > 65535) throw new Error(t('Enter a name, host and valid port.'));
    await saveProxy({ ...draft, name: draft.name.trim(), host: draft.host.trim() });
    setDraft(current => ({ ...current, password: '', hasPassword: current.hasPassword || !!current.password }));
  });
  useDialogKeyboard(ref, true, { onClose, onSubmit: () => void save(), disabled: busy });
  return createPortal(<div className="new-tab-overlay" onClick={() => { if (!busy) onClose(); }}>
    <div ref={ref} role="dialog" aria-modal="true" aria-label={t('Manage proxies')} className="workspace-floating workspace-floating-dialog ssh-proxy-dialog" onClick={event => event.stopPropagation()}>
      <header><h2>{t('Manage proxies')}</h2></header>
      <div className="ssh-form-section scroll-region">
        <label>{t('Device default')}<Select aria-label={t('Device default')} value={config.defaultId ?? 'none'} options={[{ value: 'none', label: t('No proxy') }, ...config.profiles.map(profile => ({ value: profile.id, label: profile.name }))]} onChange={id => void action(() => setDefaultProxy(id === 'none' ? null : id))} disabled={busy} /></label>
        <label>{t('Proxy profile')}<Select aria-label={t('Proxy profile')} value={config.profiles.some(profile => profile.id === draft.id) ? draft.id : 'new'} options={[{ value: 'new', label: t('New proxy') }, ...config.profiles.map(profile => ({ value: profile.id, label: profile.name }))]} onChange={id => setDraft(id === 'new' ? emptyProfile() : { ...config.profiles.find(profile => profile.id === id)!, password: '' })} /></label>
        <label>{t('Name')}<TextInput variant="field" value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} data-testid="proxy-name" /></label>
        <label>{t('Protocol')}<Select aria-label={t('Protocol')} value={draft.kind} options={[{ value: 'socks5', label: 'SOCKS5' }, { value: 'http', label: 'HTTP CONNECT' }]} onChange={value => setDraft({ ...draft, kind: value as ProxyProfile['kind'] })} /></label>
        <div className="ssh-editor-address"><label>{t('Host')}<TextInput variant="field" value={draft.host} onChange={event => setDraft({ ...draft, host: event.target.value })} data-testid="proxy-host" /></label><label>{t('Port')}<TextInput variant="field" type="number" value={draft.port || ''} onChange={event => setDraft({ ...draft, port: Number(event.target.value) })} data-testid="proxy-port" /></label></div>
        <label>{t('Username (optional)')}<TextInput variant="field" value={draft.username} onChange={event => setDraft({ ...draft, username: event.target.value })} data-testid="proxy-username" /></label>
        <label>{t('Password')}<TextInput variant="field" type="password" value={draft.password ?? ''} placeholder={draft.hasPassword ? t('Leave empty to keep the stored password') : ''} onChange={event => setDraft({ ...draft, password: event.target.value })} data-testid="proxy-password" /></label>
        <p>{t('Proxy credentials are stored separately from connection profiles.')}</p>
        {error && <ErrorBox compact>{error}</ErrorBox>}
      </div>
      <footer className="ssh-form-footer">{config.profiles.some(profile => profile.id === draft.id) && <TextButton disabled={busy} onClick={() => setDeleting(true)}>{t('Delete proxy')}</TextButton>}<span style={{ flex: 1 }} /><TextButton disabled={busy} onClick={onClose}>{t('Close')}</TextButton><TextButton disabled={busy} onClick={() => void save()} data-testid="proxy-save">{t('Save proxy')}</TextButton></footer>
    </div>
    {deleting && <ConfirmDialog open danger title={t('Delete proxy?')} message={t('Connections using this proxy will require another proxy or a direct connection.')} onConfirm={() => { setDeleting(false); void action(async () => { await deleteProxy(draft.id); setDraft(emptyProfile()); }); }} onCancel={() => setDeleting(false)} />}
  </div>, document.body);
}
