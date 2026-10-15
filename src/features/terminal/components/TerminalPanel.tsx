import SshSessionGate from './SshSessionGate';
import { TextInput } from '@ui/TextInput';
import '@xterm/xterm/css/xterm.css';
import { useTerminalSession } from '../hooks/useTerminalSession';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTerminalStore } from '@features/terminal';
import { ptyWrite } from '@platform/pty';
import ErrorBox from '@ui/ErrorBox';
import Select from '@ui/Select';
import { TextButton } from '@ui/TextButton';
import { IconButton } from '@ui/IconButton';
import { Eye, iconSizes } from '@ui/icons';
import { secretResponsePrompt, secretResponseWasRejected } from '../model/terminalFrame';
import { t } from '@i18n';
import { terminalDebug } from '../services/terminalDebug';
import type { SshSessionStatus } from '@core/ssh';

/** Render an interactive SSH session with xterm so screen contents and cursor stay in sync. */
interface TerminalPanelProps {
  paneId: string; tabId: string; onReady: (sessionId: string) => void; connectionInput?: boolean;
  /** 连接页状态行显示的目标（用户@主机），由标签的 SSH 目标传入。 */
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
    // 密码框开着时终端不接受输入：否则切回「密码输入」后仍能点进屏幕里打字
    if (inputDisabled || secret) return;
    ref.current?.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea')?.focus();
  };
  useEffect(() => {
    if (!interactive || !sessionId) return;
    if (secret) responseRef.current?.focus();
    else ref.current?.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea')?.focus();
  }, [interactive, sessionId, secret, ref]);

  const cancelAuthentication = async () => {
    if (!sessionId || cancellingRef.current) return;
    cancellingRef.current = true;
    setCancelledAuthentication(secret && !sshAuthenticated);
    setCancellation('pending'); setResponse(''); setError('');
    try { await closeSession(); setCancellation('done'); }
    catch (reason) { cancellingRef.current = false; setCancellation('idle'); setError(`取消失败：${String(reason)}`); }
  };
  const restart = async () => {
    if (cancellation === 'pending') return;
    setCancellation('pending'); setResponse(''); setError(''); setManualSecret(false); setDirectInput(false); setDismissedPrompt(null);
    terminalDebug('ssh-reconnect-request', { paneId });
    try { await reconnect(); cancellingRef.current = false; setCancellation('idle'); }
    catch (reason) { setCancellation('idle'); setError(`重连失败：${String(reason)}`); }
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
  // 只要密码框开着就把屏幕冻结成快照：live xterm 会画自己的光标，看着像还有输入焦点
  const showSnapshot = !disconnected && secret;
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
  // 断线后把最后几行输出直接印在屏幕上（就是 ssh 给出的原因），不做卡片、也不回放整屏历史
  const outputTail = disconnected
    ? [text.split('\n').map((line) => line.trimEnd()).filter((line) => line.trim().length > 0).slice(-8).join('\n'), exitNoticeShown ? '' : exitNotice].filter(Boolean).join('\n')
    : '';
  // 选择器显示「现在用哪种输入」：输密码框可见就是密码输入，否则是直接输入
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
    {connectionInput && <div data-testid="ssh-connection-input" style={{ position: 'absolute', inset: 0, display: interactive ? 'flex' : 'none', flexDirection: 'column', gap: 8 }}>
      {showToolbar && !toolbarHost && toolbar}
      {/* 终端区常驻：xterm 宿主必须一直在，否则重连时没有宿主可挂载；断开后宿主隐藏、原因直接印在屏幕上 */}
      <div role="textbox" aria-label="SSH 交互终端" aria-multiline="true"
        aria-disabled={inputDisabled || secret} tabIndex={inputDisabled || secret ? -1 : 0}
        onFocus={focusTerminal} onMouseDown={focusTerminal} style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'auto', outline: 'none', cursor: 'text' }}>
        {/* 密码框开着（secret）时屏幕只读，点它也不会把输入交给终端 */}
        <div ref={ref} data-testid={showSnapshot ? undefined : 'ssh-terminal-screen'} style={{ position: 'absolute', inset: 0, overflow: 'auto', visibility: showSnapshot || disconnected ? 'hidden' : 'visible', pointerEvents: showSnapshot || disconnected || secret ? 'none' : 'auto', paddingLeft: 8 }} />
          {/* data-selectable：页面整体禁选，但屏幕内容必须能选中，否则连不上时无法复制报错 */}
          {showSnapshot && frame?.html && <pre data-selectable data-testid="ssh-terminal-screen" className="ssh-terminal-frame" style={{ position: 'absolute', inset: 0, overflow: 'auto', margin: 0, whiteSpace: 'pre', paddingLeft: 8 }} dangerouslySetInnerHTML={{ __html: frame.html }} />}
        {/* 连接中：居中转圈 + 细进度条（不写解释性小字） */}
        {!disconnected && status === 'connecting' && (
          <div data-testid="ssh-connecting" aria-hidden="true" style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, pointerEvents: 'none' }}>
            <span className="ssh-connect-spinner" />
            <span style={{ fontSize: 'calc(14px * var(--ui-font-scale))', color: 'var(--text-primary)' }}>{t('ssh.connecting.to', { target: sshTarget ?? '' })}</span>
            <span className="ssh-connect-progress"><i /></span>
          </div>
        )}
        {/* 连接已结束：原因就当终端输出印在屏幕上，不加卡片、不回放整屏 */}
        {disconnected && (
          <pre data-selectable data-testid="ssh-terminal-ended" className="ssh-terminal-frame" style={{ position: 'absolute', inset: 0, overflow: 'auto', margin: 0, padding: '0 8px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{outputTail}</pre>
        )}
      </div>
      {/* 认证输入条：与终端区左右保持一致的 8px 边距（对称，不再贴边或被单侧推偏） */}
      {interactive && secret && !disconnected && <div style={{ padding: '0 8px 8px', flexShrink: 0 }}>
        <form onSubmit={e => {
          e.preventDefault();
          if (inputDisabled || cancellingRef.current || !sessionId) return;
          const value = response;
          if (responseRef.current) responseRef.current.value = '';
          setResponse(''); setError(''); setManualSecret(false); setDirectInput(false); setDismissedPrompt(secretPrompt ?? text);
          void ptyWrite(sessionId, `${value}\r`).catch(reason => { setManualSecret(true); setError(`发送失败：${String(reason)}`); });
        }} className="terminal-composer" style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 12, width: '100%' }}>
          <TextInput ref={responseRef} type={reveal ? 'text' : 'password'} autoComplete="off" aria-label="SSH 认证响应" placeholder="输入密码、密钥口令或验证响应" value={response} onChange={e => setResponse(e.target.value)} disabled={inputDisabled} className="ssh-auth-response" style={{ flex: 1, minWidth: 0, height: 36, background: 'transparent', border: 'none', outline: 'none' }} />
          <IconButton compact data-subtle data-testid="ssh-auth-reveal" aria-pressed={reveal} aria-label={t(reveal ? 'Hide password' : 'Show password')} data-tip={t(reveal ? 'Hide password' : 'Show password')} onClick={() => { setReveal(value => !value); responseRef.current?.focus(); }}><Eye size={iconSizes.compact} /></IconButton>
          <button type="submit" className="ssh-auth-submit" disabled={inputDisabled} style={{ padding: '8px 16px' }}>发送</button>
        </form>
      </div>}
      {error && <ErrorBox compact style={{ flexShrink: 0 }}>{error}</ErrorBox>}
    </div>}
  </div>;
}
