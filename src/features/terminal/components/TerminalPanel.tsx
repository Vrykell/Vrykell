import '@xterm/xterm/css/xterm.css';
import { useTerminalSession } from '../hooks/useTerminalSession';
import { useEffect, useRef, useState } from 'react';
import { useTerminalStore } from '@features/terminal';
import { ptyWrite } from '@platform/pty';
import ErrorBox from '@ui/ErrorBox';
import { secretResponsePrompt, secretResponseWasRejected } from '../model/terminalFrame';
import { terminalDebug } from '../services/terminalDebug';

/** Render an interactive SSH session with xterm so screen contents and cursor stay in sync. */
export default function TerminalPanel({ paneId, tabId, onReady, connectionInput = false }: {
  paneId: string; tabId: string; onReady: (sessionId: string) => void; connectionInput?: boolean;
}) {
  const { ref, closeSession, reconnect, status, frame } = useTerminalSession(paneId, tabId, onReady);
  const [response, setResponse] = useState('');
  const [error, setError] = useState('');
  const [cancellation, setCancellation] = useState<'idle' | 'pending' | 'done'>('idle');
  const [cancelledAuthentication, setCancelledAuthentication] = useState(false);
  const [manualSecret, setManualSecret] = useState(false);
  const [directInput, setDirectInput] = useState(false);
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
  const focusTerminal = () => {
    if (!inputDisabled) ref.current?.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea')?.focus();
  };
  useEffect(() => {
    if (!interactive || !sessionId) return;
    if (secret) responseRef.current?.focus();
    else ref.current?.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea')?.focus();
  }, [interactive, sessionId, secret, ref]);

  const cancelAuthentication = async () => {
    if (!sessionId || cancellingRef.current) return;
    cancellingRef.current = true;
    setCancelledAuthentication(secret);
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
  const showSnapshot = (!manualSecret && secret && secretPrompt !== null) || disconnected;
  return <div style={{ width: '100%', height: '100%', position: 'relative' }}>
    {!connectionInput && <div ref={ref} style={{ position: 'absolute', inset: 0, minHeight: 0, background: 'transparent', paddingLeft: 8 }} />}
    {connectionInput && <div data-testid="ssh-connection-input" style={{ position: 'absolute', inset: 0, display: interactive ? 'flex' : 'none', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0, padding: '4px 8px', fontSize: 'calc(12px * var(--ui-font-scale))' }}>
        <span role="status" style={{ flex: 1, color: 'var(--text-secondary)' }}>{cancellation === 'done' ? cancelledAuthentication ? '已取消认证，SSH 连接已关闭' : '已断开 SSH 连接' : disconnected ? '连接已断开' : status === 'connecting' ? '正在连接…' : secret ? '等待认证响应' : 'SSH 交互会话'}</span>
        {!disconnected && <button type="button" disabled={inputDisabled} onClick={() => {
          if (secret) {
            setManualSecret(false);
            setDirectInput(true);
            if (secretPrompt) setDismissedPrompt(secretPrompt);
          } else {
            setDirectInput(false);
            setManualSecret(true);
          }
        }} style={{ padding: '7px 12px' }}>{secret ? '直接输入' : '密码输入'}</button>}
        {disconnected ? <button type="button" disabled={cancellation === 'pending'} onClick={() => void restart()} style={{ padding: '7px 12px' }}>重新连接</button>
          : <button type="button" disabled={inputDisabled} onClick={() => void cancelAuthentication()} style={{ padding: '7px 12px' }}>{cancellation === 'pending' ? '正在取消…' : secret ? '取消认证' : '断开连接'}</button>}
      </div>
      <div role="textbox" aria-label="SSH 交互终端" aria-multiline="true" aria-disabled={inputDisabled} tabIndex={inputDisabled ? -1 : 0}
        onFocus={focusTerminal} onMouseDown={focusTerminal} style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'auto', outline: 'none', cursor: 'text' }}>
        <div ref={ref} data-testid={showSnapshot ? undefined : 'ssh-terminal-screen'} style={{ position: 'absolute', inset: 0, overflow: 'auto', visibility: showSnapshot ? 'hidden' : 'visible', pointerEvents: showSnapshot ? 'none' : 'auto', paddingLeft: 8 }} />
        {showSnapshot && <pre data-testid="ssh-terminal-screen" style={{ position: 'absolute', inset: 0, overflow: 'auto', margin: 0, whiteSpace: 'pre', color: 'var(--text-primary)', paddingLeft: 8 }} dangerouslySetInnerHTML={{ __html: frame?.html || '正在连接远端主机…' }} />}
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
          <input ref={responseRef} type="password" autoComplete="off" aria-label="SSH 认证响应" placeholder="输入密码、密钥口令或验证响应" value={response} onChange={e => setResponse(e.target.value)} disabled={inputDisabled} className="ssh-auth-response" style={{ flex: 1, minWidth: 0, height: 36, background: 'transparent', border: 'none', outline: 'none' }} />
          <button type="submit" disabled={inputDisabled} style={{ padding: '8px 16px' }}>发送</button>
        </form>
      </div>}
      {error && <ErrorBox compact style={{ flexShrink: 0 }}>{error}</ErrorBox>}
    </div>}
  </div>;
}
