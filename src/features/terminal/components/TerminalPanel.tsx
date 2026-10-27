import SshSessionGate from './SshSessionGate';
import { TextInput } from '@ui/fields/TextInput';
import '@xterm/xterm/css/xterm.css';
import { useTerminalSession } from '../hooks/useTerminalSession';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTerminalStore } from '@features/terminal';
import { ptyWrite } from '@platform/pty';
import ErrorBox from '@ui/feedback/ErrorBox';
import Select from '@ui/fields/Select';
import { sanitizeOutputHtml } from '@utils/sanitizeHtml';
import { TextButton } from '@ui/actions/TextButton';
import { IconButton } from '@ui/actions/IconButton';
import { Eye, EyeOff, iconSizes } from '@ui/icons';
import { secretResponsePrompt, secretResponseWasRejected } from '../model/terminalFrame';
import { t } from '@i18n';
import { isTerminalDebugEnabled, terminalDebug } from '../services/terminalDebug';
import type { SshSessionStatus } from '@core/ssh';
import { useSessionStore, useUiStore, useWorkspaceNavigation } from '@features/workspace';

/** Render an interactive SSH session with xterm so screen contents and cursor stay in sync. */
interface TerminalPanelProps {
  paneId: string; tabId: string; onReady: (sessionId: string) => void; connectionInput?: boolean;
  /** Target shown in the connection page status row (user@host), passed from the tab's SSH target. */
  sshTarget?: string;
  connectionId?: string;
  toolbarHost?: HTMLDivElement | null;
  showToolbar?: boolean;
  onDisconnectReady?: (action: (() => Promise<void>) | null) => void;
  onSessionStatusClick?: () => void;
  onSessionStatusReady?: (button: HTMLButtonElement | null) => void;
  sessionStatusOpen?: boolean;
  onSshStateChange?: (state: SshSessionStatus) => void;
  onReconnectReady?: (action: (() => Promise<void>) | null) => void;
}

export default function TerminalPanel(props: TerminalPanelProps) {
  return props.connectionId ? <SshSessionGate connectionId={props.connectionId} paneId={props.paneId} tabId={props.tabId} onSshStateChange={props.onSshStateChange}>
    <ConnectedTerminalPanel key={props.connectionId} {...props} />
  </SshSessionGate> : <ConnectedTerminalPanel key="direct" {...props} />;
}

function ConnectedTerminalPanel({ paneId, tabId, onReady, connectionInput = false, sshTarget, onSshStateChange, onReconnectReady, toolbarHost, showToolbar = true, onDisconnectReady, onSessionStatusClick, onSessionStatusReady, sessionStatusOpen }: TerminalPanelProps) {
  const { ref, closeSession, reconnect, stopReconnect, retry, status, frame, sshAuthenticated, sshLog } = useTerminalSession(paneId, tabId, onReady);
  // The screen snapshot is built by our own renderer, but it is also persisted and restored, so it
  // goes through the same sanitizing the command blocks use before it reaches the DOM.
  const frameHtml = useMemo(() => (frame?.html ? sanitizeOutputHtml(frame.html) : ''), [frame?.html]);
  const [response, setResponse] = useState('');
  const [error, setError] = useState('');
  const [cancellation, setCancellation] = useState<'idle' | 'pending' | 'done'>('idle');
  const [cancelledAuthentication, setCancelledAuthentication] = useState(false);
  const [manualSecret, setManualSecret] = useState(false);
  const [directInput, setDirectInput] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [dismissedPrompt, setDismissedPrompt] = useState<string | null>(null);
  const cancellingRef = useRef(false);
  const responseRef = useRef<HTMLInputElement>(null);
  const sessionId = useTerminalStore(s => s.sessions[paneId]);
  const activeTab = useSessionStore(state => state.activeId === tabId);
  const terminalArea = useWorkspaceNavigation(state => state.area === 'terminal' || state.area === 'unified');
  const settingsOpen = useUiStore(state => state.settingsOpen);
  const scene = useTerminalStore(s => s.scenes[paneId] ?? 'classic');
  const interactive = connectionInput && (scene !== 'blockList' || cancellation !== 'idle');
  const text = frame?.plainText ?? '';
  const secretPrompt = secretResponsePrompt(text);
  const secret = !directInput && (manualSecret || (secretPrompt !== null && (dismissedPrompt !== secretPrompt || secretResponseWasRejected(text))));
  const inputDisabled = !sessionId || cancellation !== 'idle';
  const disconnected = status === 'closed' || status === 'error' || cancellation === 'done';
  const exitNotice = t('terminal.processExited');
  const exitNoticeShown = (frame?.plainText ?? '').includes(exitNotice);
  const focusTerminal = () => {
    // While the secret prompt is open the terminal takes no input; otherwise switching back to password entry would still let the user type into the screen.
    if (inputDisabled || secret) return;
    ref.current?.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea')?.focus();
  };
  useEffect(() => {
    if (!interactive || !sessionId || !activeTab || !terminalArea || settingsOpen) return;
    if (secret) responseRef.current?.focus();
    else ref.current?.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea')?.focus();
  }, [interactive, sessionId, secret, ref, activeTab, terminalArea, settingsOpen]);

  const cancelAuthentication = async () => {
    if (!sessionId || cancellingRef.current) return;
    cancellingRef.current = true;
    setCancelledAuthentication(secret && !sshAuthenticated);
    setCancellation('pending'); setResponse(''); setError('');
    try { await closeSession(); setCancellation('done'); }
    catch (reason) { cancellingRef.current = false; setCancellation('idle'); setError(t('Cancel failed: {{error}}', { error: String(reason) })); }
  };
  const restart = async () => {
    if (cancellation === 'pending') return;
    setCancellation('pending'); setResponse(''); setError(''); setManualSecret(false); setDirectInput(false); setDismissedPrompt(null);
    terminalDebug('ssh-reconnect-request', { paneId });
    try { await reconnect(); cancellingRef.current = false; setCancellation('idle'); }
    catch (reason) { setCancellation('idle'); setError(t('Reconnect failed: {{error}}', { error: String(reason) })); }
  };
  useEffect(() => {
    if (!connectionInput) return;
    onDisconnectReady?.(async () => { await closeSession(); setCancelledAuthentication(false); setCancellation('done'); });
    return () => onDisconnectReady?.(null);
  }, [connectionInput, closeSession, onDisconnectReady]);
  useEffect(() => {
    if (!connectionInput) return;
    onReconnectReady?.(restart);
    return () => onReconnectReady?.(null);
  }, [connectionInput, onReconnectReady, restart]);
  // Freeze the screen into a snapshot while the secret prompt is open: a live terminal draws its own cursor and looks like it still has input focus.
  const showSnapshot = !disconnected && secret;
  // Diagnostics: record the rendered snapshot geometry so a width mismatch between the
  // canvas grid and the DOM frame can be traced from the recorded log.
  const snapshotRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (!showSnapshot || !frame?.html || !isTerminalDebugEnabled()) return;
    const raf = requestAnimationFrame(() => {
      const pre = snapshotRef.current;
      if (!pre) return;
      const style = getComputedStyle(pre);
      const probe = document.createElement('span');
      probe.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;white-space:pre;';
      probe.style.fontFamily = style.fontFamily;
      probe.style.fontSize = style.fontSize;
      probe.style.fontWeight = style.fontWeight;
      probe.style.letterSpacing = style.letterSpacing;
      probe.textContent = 'W'.repeat(100);
      document.body.appendChild(probe);
      const advance = Math.round(probe.getBoundingClientRect().width);
      probe.remove();
      const root = getComputedStyle(document.documentElement);
      terminalDebug('ssh-snapshot-frame', {
        paneId,
        cols: frame.cols, rows: frame.rows,
        clientWidth: pre.clientWidth, scrollWidth: pre.scrollWidth,
        hostWidth: ref.current?.clientWidth ?? null,
        cellWidth: frame.cellWidth ?? null, snapshotSpacing: frame.snapshotSpacing ?? null,
        advancePer100Cells: advance,
        letterSpacing: style.letterSpacing, fontSize: style.fontSize,
        cssLetterSpacing: root.getPropertyValue('--terminal-letter-spacing').trim(),
        cssFontSize: root.getPropertyValue('--terminal-font-size').trim(),
        devicePixelRatio: window.devicePixelRatio,
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [showSnapshot, frame]);
  const retryPhase = retry?.phase ?? 'idle';
  const retryWaiting = retryPhase === 'waiting';
  const retryConnecting = retryPhase === 'connecting';
  const stateLabel = cancellation === 'done'
    ? (cancelledAuthentication ? t('ssh.state.authCancelled') : t('ssh.state.manualClosed'))
    : disconnected ? t('ssh.state.disconnected')
      : status === 'connecting' ? t('ssh.state.connecting')
        : secret && !sshAuthenticated ? t('ssh.state.authenticating')
          : sshAuthenticated ? t('Connected') : t('ssh.state.connected');
  const stateColor = disconnected ? 'var(--error)' : (!sshAuthenticated && (secret || status === 'connecting')) ? 'var(--accent-warm)' : 'var(--accent)';
  const connectionPhase = disconnected ? 'disconnected' : sshAuthenticated ? 'connected' : secret ? 'authenticating' : status === 'connecting' ? 'connecting' : 'interactive';
  useEffect(() => {
    if (connectionInput) onSshStateChange?.({ phase: connectionPhase, reconnectAttempt: retry.attempt, retrying: retry.phase === 'waiting' || retry.phase === 'connecting', log: sshLog });
  }, [connectionInput, connectionPhase, retry.attempt, retry.phase, onSshStateChange, sshLog]);
  // After a disconnect, print the last output lines directly on the screen (the reason the connection ended), with no card and no full-screen replay.
  const outputTail = disconnected
    ? [text.split('\n').map((line) => line.trimEnd()).filter((line) => line.trim().length > 0).slice(-8).join('\n'), exitNoticeShown ? '' : exitNotice].filter(Boolean).join('\n')
    : '';
  // The selector shows which input mode is active: password entry while the secret prompt is visible, direct input otherwise.
  const inputMode = secret ? 'secret' : 'direct';
  const connectionStatus = <><span aria-hidden="true" className="ssh-status-dot" style={{ background: stateColor }} />
    <span role="status" className="ssh-session-toolbar-state" style={{ color: 'var(--text-primary)' }}>{retryWaiting ? t('Retry {{n}}/5 in {{seconds}} seconds', { n: retry.attempt, seconds: retry.seconds }) : retryConnecting ? t('Reconnecting ({{n}}/5)…', { n: retry.attempt }) : retryPhase === 'exhausted' ? t('Automatic reconnect ended after 5 attempts') : retryPhase === 'stopped' ? t('Automatic reconnect stopped') : stateLabel}</span></>;
  const toolbar = <div data-testid="ssh-session-toolbar" style={{ minWidth: 0, width: "100%", display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0, padding: toolbarHost ? '0' : '4px 8px', fontSize: 'calc(12px * var(--ui-font-scale))' }}>
        {onSessionStatusClick ? <TextButton ref={onSessionStatusReady} className="ssh-session-status" data-testid="ssh-status-toggle" aria-label={t('SSH status')} aria-expanded={sessionStatusOpen ?? false} data-tip={t(sessionStatusOpen ? 'Close SSH status' : 'Open SSH status')} onClick={onSessionStatusClick}>{connectionStatus}</TextButton> : connectionStatus}
        {sshTarget && <span className="ssh-session-toolbar-target" data-tip={sshTarget} style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sshTarget}</span>}
        <span style={{ flex: 1 }} />
        {/* Input mode uses an explicit selection. */}
        {interactive && !disconnected && sessionId && (
          <Select
            aria-label={t('ssh.input.mode')}
            data-testid="ssh-input-mode"
            value={inputMode}
            disabled={inputDisabled}
            options={[{ value: 'secret', label: t('ssh.input.password') }, { value: 'direct', label: t('ssh.input.direct') }]}
            onChange={(value) => {
              if (value === 'direct') {
                setManualSecret(false);
                setDirectInput(true);
                if (secretPrompt) setDismissedPrompt(secretPrompt);
              } else {
                setDirectInput(false);
                setManualSecret(true);
              }
            }}
            style={{ height: 'var(--control-size)', minWidth: 108, fontSize: 'calc(12px * var(--ui-font-scale))' }}
          />
        )}
        {(retryWaiting || retryConnecting) && <button type="button" onClick={() => void stopReconnect()} style={{ height: 'var(--control-size)', padding: '0 12px' }}>{t('Stop retrying')}</button>}
        {disconnected
          ? <button type="button" disabled={cancellation === 'pending'} onClick={() => void restart()} style={{ height: 'var(--control-size)', padding: '0 12px' }}>{retryWaiting ? t('Retry now') : t('ssh.action.reconnect')}</button>
          : <button type="button" disabled={inputDisabled} onClick={() => void cancelAuthentication()} style={{ height: 'var(--control-size)', padding: '0 12px' }}>{cancellation === 'pending' ? t('ssh.action.cancelling') : secret && !sshAuthenticated ? t('ssh.action.cancelAuth') : status === 'connecting' ? t('ssh.action.cancelConnect') : t('ssh.action.disconnect')}</button>}
      </div>;
  return <div style={{ width: '100%', height: '100%', position: 'relative' }}>
    {connectionInput && showToolbar && toolbarHost && createPortal(toolbar, toolbarHost)}
    {!connectionInput && <div ref={ref} style={{ position: 'absolute', inset: 0, minHeight: 0, background: 'transparent', paddingLeft: 8 }} />}
    {/* Keep the sizing host measurable while block output owns the visible pane. */}
    {connectionInput && <div data-testid="ssh-connection-input" inert={!interactive} aria-hidden={!interactive || undefined} style={{ position: 'absolute', inset: 0, display: 'flex', visibility: interactive ? 'visible' : 'hidden', flexDirection: 'column', gap: 8 }}>
      {showToolbar && !toolbarHost && toolbar}
      {/* The terminal area stays mounted: the terminal host must remain so a reconnect has somewhere to mount, and after a disconnect the host hides while the reason is printed on screen. */}
      <div role="textbox" aria-label={t('SSH interactive terminal')} aria-multiline="true"
        aria-disabled={inputDisabled || secret} tabIndex={inputDisabled || secret ? -1 : 0}
        onFocus={focusTerminal} onMouseDown={focusTerminal} style={{ flex: 1, minHeight: 0, position: 'relative', overflowX: 'hidden', overflowY: 'auto', outline: 'none', cursor: 'text' }}>
        {/* While the secret prompt is open the screen is read-only, so clicking it never routes input to the terminal. */}
        <div ref={ref} data-testid={showSnapshot ? undefined : 'ssh-terminal-screen'} style={{ position: 'absolute', inset: 0, overflowX: 'hidden', overflowY: 'auto', visibility: !interactive || showSnapshot || disconnected ? 'hidden' : 'visible', pointerEvents: !interactive || showSnapshot || disconnected || secret ? 'none' : 'auto', paddingLeft: 8 }} />
          {/* data-selectable: the page disables selection globally, but screen content must stay
              selectable so an error can be copied when the connection fails. Rows advance at the
              renderer's own cell width and never scroll sideways; a horizontal scrollbar would
              steal height and make the terminal bounce. */}
          {showSnapshot && frameHtml && <pre ref={snapshotRef} data-selectable data-testid="ssh-terminal-screen" className="ssh-terminal-frame" style={{ position: 'absolute', inset: 0, overflowX: 'hidden', overflowY: 'auto', letterSpacing: frame?.snapshotSpacing != null ? `calc(var(--terminal-letter-spacing, 0px) + ${frame.snapshotSpacing}px)` : undefined, margin: 0, whiteSpace: 'pre', color: 'var(--text-primary)', paddingLeft: 8 }} dangerouslySetInnerHTML={{ __html: frameHtml }} />}
        {/* Connecting: centered spinner and thin progress bar, with no explanatory copy. */}
        {!disconnected && status === 'connecting' && (
          <div data-testid="ssh-connecting" aria-hidden="true" style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, pointerEvents: 'none' }}>
            <span className="ssh-connect-spinner" />
            <span style={{ fontSize: 'calc(14px * var(--ui-font-scale))', color: 'var(--text-primary)' }}>{t('ssh.connecting.to', { target: sshTarget ?? '' })}</span>
            <span className="ssh-connect-progress"><i /></span>
          </div>
        )}
        {/* Connection ended: print the reason as terminal output, without a card or a full-screen replay. */}
        {disconnected && (
          <pre data-selectable data-testid="ssh-terminal-ended" className="ssh-terminal-frame" style={{ position: 'absolute', inset: 0, overflow: 'auto', margin: 0, padding: '0 8px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{outputTail}</pre>
        )}
      </div>
      {/* Authentication input row: the same 8px inset on both sides as the terminal area, so it stays centered. */}
      {interactive && secret && !disconnected && <div style={{ padding: '0 8px 8px', flexShrink: 0 }}>
        <form onSubmit={e => {
          e.preventDefault();
          if (inputDisabled || cancellingRef.current || !sessionId) return;
          const value = response;
          if (responseRef.current) responseRef.current.value = '';
          setResponse(''); setError(''); setManualSecret(false); setDirectInput(false); setDismissedPrompt(secretPrompt ?? text);
          void ptyWrite(sessionId, `${value}\r`).catch(reason => { setManualSecret(true); setError(t('Send failed: {{error}}', { error: String(reason) })); });
        }} className="terminal-composer" style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 12, width: '100%' }}>
          <TextInput ref={responseRef} type={reveal ? 'text' : 'password'} autoComplete="off" aria-label={t('SSH authentication response')} placeholder={t('Enter a password, key passphrase or verification response')} value={response} onChange={e => setResponse(e.target.value)} disabled={inputDisabled} className="ssh-auth-response" style={{ flex: 1, minWidth: 0, height: 36, background: 'transparent', border: 'none', outline: 'none' }} />
          <IconButton compact data-subtle className="ssh-auth-reveal" data-testid="ssh-auth-reveal" aria-pressed={reveal} aria-label={t(reveal ? 'Hide password' : 'Show password')} data-tip={t(reveal ? 'Hide password' : 'Show password')} onClick={() => { setReveal(value => !value); responseRef.current?.focus(); }}>{reveal ? <EyeOff size={iconSizes.compact} /> : <Eye size={iconSizes.compact} />}</IconButton>
          <button type="submit" className="ssh-auth-submit" disabled={inputDisabled} style={{ padding: '8px 16px' }}>{t('Send')}</button>
        </form>
      </div>}
      {error && <ErrorBox compact style={{ flexShrink: 0 }}>{error}</ErrorBox>}
    </div>}
  </div>;
}
