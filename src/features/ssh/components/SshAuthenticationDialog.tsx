import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { t } from '@i18n';
import { TextInput } from '@ui/fields/TextInput';
import { TextButton } from '@ui/actions/TextButton';
import Select from '@ui/fields/Select';
import ErrorBox from '@ui/feedback/ErrorBox';
import { useDialogKeyboard } from '@ui/hooks/useDialogKeyboard';
import { sshAuthenticateSession } from '../services/api';
import { forgetSshAuthentication, useHasTemporarySshAuthentication } from '../hooks/useSessionAuthentication';
import { finishSshAuthentication, useSessionAuthenticationStore } from '@features/ssh';
import type { SshAuthenticationTarget } from '@core/ssh';
import './SshConnection.css';

function AuthenticationDialog({ target }: { target: SshAuthenticationTarget & { requestId: number } }) {
  const dialog = useRef<HTMLDivElement>(null);
  const submitting = useRef(false);
  const hasTemporary = useHasTemporarySshAuthentication(target.connectionId);
  const [method, setMethod] = useState<'password' | 'keyPassphrase'>('password');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const cancel = () => {
    if (submitting.current) return;
    setSecret('');
    useSessionAuthenticationStore.setState({ request: null });
  };
  const submit = async () => {
    if (submitting.current || !secret) return;
    submitting.current = true;
    setBusy(true); setError('');
    const value = secret;
    setSecret('');
    try {
      await sshAuthenticateSession(target, method, value);
      finishSshAuthentication(target.requestId);
    } catch (reason) {
      if (useSessionAuthenticationStore.getState().request?.requestId === target.requestId) setError(String(reason));
    } finally { submitting.current = false; setBusy(false); }
  };
  useDialogKeyboard(dialog, true, { onClose: cancel, onSubmit: () => { void submit(); }, disabled: busy, initialFocus: '#ssh-session-secret' });
  return createPortal(<div className="ssh-auth-overlay" onMouseDown={event => { if (event.target === event.currentTarget) cancel(); }}>
    <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="ssh-auth-heading" className="workspace-floating workspace-floating-dialog ssh-form-dialog ssh-auth-dialog" data-testid="ssh-auth-dialog">
      <header className="ssh-form-header"><h2 id="ssh-auth-heading">{t('Authenticate file and resource services')}</h2></header>
      <div className="ssh-form-body ssh-form-section">
        <p className="ssh-auth-address">{target.user ? `${target.user}@` : ''}{target.host}:{target.port ?? 22}</p>
        <p>{t(target.identityFile ? 'Enter the server password, or the passphrase for the configured private key. File browsing and monitoring share this authentication.' : 'Enter the server password. File browsing and monitoring share this authentication.')}</p>
        {target.identityFile && <label>{t('Authentication method')}<Select disabled={busy} aria-label={t('Authentication method')} value={method} onChange={value => { setMethod(value as typeof method); setSecret(''); setError(''); }} options={[
          { value: 'password', label: t('Server password') }, { value: 'keyPassphrase', label: t('Private key passphrase') },
        ]} /></label>}
        <label htmlFor="ssh-session-secret">{t(method === 'password' ? 'Server password' : 'Private key passphrase')}
          <TextInput id="ssh-session-secret" type="password" value={secret} maxLength={4096} disabled={busy} onChange={event => setSecret(event.target.value)} data-testid="ssh-session-secret" />
        </label>
        <p>{t('Used only in memory until the last terminal for this connection closes or the app exits. Your saved connection is unchanged.')}</p>
        {error && <ErrorBox title={t('Authentication failed')} details={error}>{t('Check the password or private key passphrase and try again.')}</ErrorBox>}
      </div>
      <footer className="ssh-form-footer">
        {hasTemporary && <TextButton disabled={busy} onClick={() => { void forgetSshAuthentication(target.connectionId).then(cancel).catch(reason => setError(String(reason))); }}>{t('Clear temporary credentials')}</TextButton>}
        <div style={{ flex: 1 }} />
        <TextButton disabled={busy} onClick={cancel}>{t('Cancel')}</TextButton>
        <TextButton className="ssh-primary-action user-primary-action" disabled={busy || !secret} onClick={() => { void submit(); }}>{t(busy ? 'Authenticating…' : 'Authenticate')}</TextButton>
      </footer>
    </div>
  </div>, document.body);
}

export default function SshAuthenticationDialog() {
  const request = useSessionAuthenticationStore(state => state.request);
  return request ? <AuthenticationDialog key={request.requestId} target={request} /> : null;
}
