import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { t } from '@i18n';
import { TextInput } from '@ui/fields/TextInput';
import { TextButton } from '@ui/actions/TextButton';
import Select from '@ui/fields/Select';
import ErrorBox from '@ui/feedback/ErrorBox';
import { useDialogKeyboard } from '@ui/hooks/useDialogKeyboard';
import { sshAuthenticateInteractive, sshAuthenticateSession, type SshAuthenticationChallenge, type SshChallengeReply } from '../services/api';
import { forgetSshAuthentication, useHasTemporarySshAuthentication } from '../hooks/useSessionAuthentication';
import { finishSshAuthentication, useSessionAuthenticationStore } from '@features/ssh';
import type { SshAuthenticationTarget } from '@core/ssh';
import './SshConnection.css';
import { useSshStore } from '../stores/store';
import { savedJumpRoute } from '../model/jumpRoute';
import { prepareSshHost } from '../services/hostTrust';
import { sshConnectionFailureMessage } from '../model/connectionFailure';

function AuthenticationDialog({ target }: { target: SshAuthenticationTarget & { requestId: number } }) {
  const dialog = useRef<HTMLDivElement>(null);
  const submitting = useRef(false);
  const replying = useRef(false);
  const active = useRef<AbortController | null>(null);
  const connections = useSshStore(state => state.connections);
  const profile = connections.find(connection => connection.id === target.connectionId);
  let route: typeof connections = [];
  try { route = savedJumpRoute(connections, profile?.jumpConnectionId, target.connectionId); } catch { /* The backend reports invalid routes. */ }
  const targets = [...route.map(hop => ({ ...hop, connectionId: hop.id })), { ...profile, ...target }];
  const [selectedId, setSelectedId] = useState(targets[0].connectionId);
  const selected = targets.find(candidate => candidate.connectionId === selectedId) ?? targets[targets.length - 1];
  const hasTemporary = useHasTemporarySshAuthentication(selected.connectionId);
  const [method, setMethod] = useState<'password' | 'keyPassphrase' | 'keyboardInteractive'>('password');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [challenge, setChallenge] = useState<{ value: SshAuthenticationChallenge; reply: SshChallengeReply } | null>(null);
  const [responses, setResponses] = useState<string[]>([]);
  const [responding, setResponding] = useState(false);
  useEffect(() => () => active.current?.abort(), []);
  useEffect(() => {
    if (challenge && !responding) dialog.current?.querySelector<HTMLInputElement>('[data-auth-response]')?.focus();
  }, [challenge, responding]);
  const cancel = () => {
    if (submitting.current && !active.current) return;
    active.current?.abort();
    setSecret('');
    setResponses([]);
    useSessionAuthenticationStore.setState({ request: null });
  };
  const submit = async () => {
    if (challenge) {
      if (replying.current) return;
      replying.current = true;
      setResponding(true); setError('');
      const answers = challenge.value.kind === 'hostKey' ? [challenge.value.fingerprint] : responses;
      setResponses(responses.map(() => ''));
      try {
        await challenge.reply(answers);
        setChallenge(current => current?.value.round === challenge.value.round ? null : current);
      } catch (reason) {
        if (!active.current?.signal.aborted) setError(String(reason));
      } finally { replying.current = false; setResponding(false); }
      return;
    }
    if (submitting.current || (method !== 'keyboardInteractive' && !secret)) return;
    submitting.current = true;
    setBusy(true); setError('');
    const value = secret;
    setSecret('');
    const controller = method === 'keyboardInteractive' ? new AbortController() : null;
    active.current = controller;
    try {
      if (method === 'keyboardInteractive' && controller) {
        await sshAuthenticateInteractive(selected, controller.signal, (value, reply) => {
          if (controller.signal.aborted) return;
          setChallenge({ value, reply });
          setResponses(value.kind === 'prompts' ? value.prompts.map(() => '') : []);
        });
      } else if (method !== 'keyboardInteractive') {
        const selectedProfile = connections.find(connection => connection.id === selected.connectionId);
        if (selectedProfile) await prepareSshHost(selected.host, selected.port, undefined, selectedProfile);
        await sshAuthenticateSession(selected, method, value);
      }
      if (controller?.signal.aborted) return;
      finishSshAuthentication(target.requestId, selected.connectionId);
      const next = targets[targets.findIndex(candidate => candidate.connectionId === selected.connectionId) + 1];
      if (next) { setSelectedId(next.connectionId); setMethod('password'); }
    } catch (reason) {
      if (useSessionAuthenticationStore.getState().request?.requestId === target.requestId) setError(String(reason));
    } finally { active.current = null; submitting.current = false; setBusy(false); setChallenge(null); setResponses([]); }
  };
  useDialogKeyboard(dialog, true, { onClose: cancel, onSubmit: () => { void submit(); }, disabled: busy && !active.current, initialFocus: '#ssh-session-secret' });
  const endpoint = challenge?.value.target ?? selected;
  return createPortal(<div className="ssh-auth-overlay" onMouseDown={event => { if (event.target === event.currentTarget) cancel(); }}>
    <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="ssh-auth-heading" className="workspace-floating workspace-floating-dialog ssh-form-dialog ssh-auth-dialog" data-testid="ssh-auth-dialog">
      <header className="ssh-form-header"><h2 id="ssh-auth-heading">{t('Authenticate file and resource services')}</h2></header>
      <div className="ssh-form-body ssh-form-section ssh-form-section-fields">
        {targets.length > 1 && <label>{t('Authentication target')}<Select disabled={busy} aria-label={t('Authentication target')} value={selected.connectionId} onChange={id => { setSelectedId(id); setSecret(''); setMethod('password'); setError(''); }} options={targets.map(candidate => ({ value: candidate.connectionId, label: `${candidate.name ?? candidate.host} (${candidate.user ?? ''}@${candidate.host})` }))} /></label>}
        <p className="ssh-auth-address">{endpoint.user ? `${endpoint.user}@` : ''}{endpoint.host}:{endpoint.port ?? 22}</p>
        {!challenge && <p>{t(method === 'keyboardInteractive' ? 'Answer the server challenges for this connection and its jump hosts. File browsing and monitoring reuse the authenticated connection.' : selected.identityFile ? 'Enter the server password, or the passphrase for the configured private key. File browsing and monitoring share this authentication.' : 'Enter the server password. File browsing and monitoring share this authentication.')}</p>}
        {targets.length > 1 && method !== 'keyboardInteractive' && <p>{t('Authenticate jump hosts in order, then authenticate the destination. Each credential stays with its own connection.')}</p>}
        {!challenge && <label>{t('Authentication method')}<Select disabled={busy} aria-label={t('Authentication method')} value={method} onChange={value => { setMethod(value as typeof method); if (value === 'keyboardInteractive') setSelectedId(target.connectionId); setSecret(''); setError(''); }} options={[
          { value: 'password', label: t('Server password') }, ...(selected.identityFile ? [{ value: 'keyPassphrase', label: t('Private key passphrase') }] : []),
          { value: 'keyboardInteractive', label: t('Server challenges (MFA)') },
        ]} /></label>}
        {!challenge && method !== 'keyboardInteractive' && <label htmlFor="ssh-session-secret">{t(method === 'password' ? 'Server password' : 'Private key passphrase')}
          <TextInput variant="field" id="ssh-session-secret" type="password" value={secret} maxLength={4096} disabled={busy} onChange={event => setSecret(event.target.value)} data-testid="ssh-session-secret" />
        </label>}
        {challenge?.value.kind === 'hostKey' && <>
          <p>{t('Verify the remote host fingerprint before trusting it.')}</p>
          <label>{t('Host fingerprint')}<TextInput variant="field" value={`${challenge.value.keyType} ${challenge.value.fingerprint}`} readOnly /></label>
        </>}
        {challenge?.value.kind === 'prompts' && <>
          {challenge.value.instructions && <p className="ssh-auth-instructions">{challenge.value.instructions}</p>}
          {challenge.value.prompts.map((prompt, index) => <label key={`${challenge.value.round}-${index}`} htmlFor={`ssh-auth-response-${index}`}>
            {prompt.text || t('Response {{number}}', { number: index + 1 })}
            <TextInput variant="field" id={`ssh-auth-response-${index}`} data-auth-response type={prompt.echo ? 'text' : 'password'} autoComplete="off" value={responses[index] ?? ''} maxLength={4096} disabled={responding}
              onChange={event => setResponses(current => current.map((value, candidate) => candidate === index ? event.target.value : value))} />
          </label>)}
        </>}
        {!challenge && !busy && <p>{t('Used only in memory until the last terminal for this connection closes or the app exits. Your saved connection is unchanged.')}</p>}
        {error && <ErrorBox title={t('Authentication failed')} details={error}>{sshConnectionFailureMessage(error) ?? t(method === 'keyboardInteractive' ? 'The server did not accept authentication. Start again to request new challenges.' : 'Check the password or private key passphrase and try again.')}</ErrorBox>}
      </div>
      <footer className="ssh-form-footer">
        {hasTemporary && <TextButton disabled={busy} onClick={() => { void forgetSshAuthentication(selected.connectionId).then(cancel).catch(reason => setError(String(reason))); }}>{t('Clear temporary credentials')}</TextButton>}
        <div style={{ flex: 1 }} />
        <TextButton disabled={busy && !active.current} onClick={cancel}>{t('Cancel')}</TextButton>
        <TextButton className="ssh-primary-action user-primary-action" disabled={responding || (busy && !challenge) || (!challenge && method !== 'keyboardInteractive' && !secret)} onClick={() => { void submit(); }}>{t(challenge?.value.kind === 'hostKey' ? 'Trust and connect' : challenge ? 'Continue' : busy ? 'Authenticating…' : 'Authenticate')}</TextButton>
      </footer>
    </div>
  </div>, document.body);
}

export default function SshAuthenticationDialog() {
  const request = useSessionAuthenticationStore(state => state.request);
  return request ? <AuthenticationDialog key={request.requestId} target={request} /> : null;
}
