import '@xterm/xterm/css/xterm.css';
import { useTerminalSession } from '@features/terminal/hooks/useTerminalSession';
import { useEffect, useRef, useState } from 'react';
import { useTerminalStore } from '@features/terminal';
import { ptyWrite } from '@platform/pty';

/** Terminal host with a separate SSH authentication surface before the remote prompt. */
export default function TerminalPanel({
  paneId,
  tabId,
  onReady,
  connectionInput = false,
}: {
  paneId: string;
  tabId: string;
  onReady: (sessionId: string) => void;
  connectionInput?: boolean;
}) {
  const [output, setOutput] = useState('');
  const [response, setResponse] = useState('');
  const [error, setError] = useState('');
  const [cancellation, setCancellation] = useState<'idle' | 'pending' | 'done'>('idle');
  const cancellingRef = useRef(false);
  const sessionId = useTerminalStore(s => s.sessions[paneId]);
  const scene = useTerminalStore(s => s.scenes[paneId] ?? 'classic');
  const interactive = connectionInput && (scene === 'classic' || cancellation !== 'idle');
  const inputDisabled = !sessionId || cancellation !== 'idle';
  const responseRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (interactive && sessionId) responseRef.current?.focus(); }, [interactive, sessionId]);
  const { ref, closeSession } = useTerminalSession(paneId, tabId, onReady, setOutput);
  const cancelAuthentication = async () => {
    if (!sessionId || cancellingRef.current) return;
    cancellingRef.current = true;
    setCancellation('pending');
    setResponse('');
    setError('');
    try {
      await closeSession();
      setCancellation('done');
    } catch (reason) {
      cancellingRef.current = false;
      setCancellation('idle');
      setError(`取消失败：${String(reason)}`);
    }
  };
  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div
        ref={ref}
        // Keep the terminal mounted for parsing while authentication uses its own input.
        style={{ width: '100%', height: '100%', minHeight: 0, background: 'transparent', visibility: interactive ? 'hidden' : 'visible' }}
      />
      {interactive && <div data-testid="ssh-connection-input" style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', gap: 12, padding: 16 }}>
        <strong style={{ fontSize: 'calc(13px * var(--ui-font-scale))' }}>SSH 连接交互</strong>
        <pre style={{ flex: 1, minHeight: 0, overflow: 'auto', whiteSpace: 'pre-wrap', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', fontSize: 'calc(13px * var(--ui-font-scale))' }}>{output || '正在连接远端主机…'}</pre>
        <form onSubmit={e => {
          e.preventDefault();
          if (!sessionId || inputDisabled || cancellingRef.current) return;
          const text = response;
          setResponse('');
          setError('');
          void ptyWrite(sessionId, `${text}\r`).catch(reason => setError(`发送失败：${String(reason)}`));
        }} className="terminal-composer" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: 12 }}>
          <input ref={responseRef} type="password" autoComplete="off" aria-label="SSH 认证响应" placeholder="输入密码、密钥口令或验证响应" value={response} onChange={e => setResponse(e.target.value)} disabled={inputDisabled} className="ssh-auth-response" style={{ flex: 1, minWidth: 140, height: 32, background: 'transparent', border: 'none', outline: 'none' }} />
          <button type="submit" disabled={inputDisabled} style={{ padding: '6px 12px', flexShrink: 0 }}>发送</button>
          <button type="button" disabled={inputDisabled} style={{ padding: '6px 12px', flexShrink: 0 }} onClick={() => void cancelAuthentication()}>{cancellation === 'pending' ? '正在取消…' : cancellation === 'done' ? '已取消认证' : '取消认证'}</button>
        </form>
        {cancellation === 'done' && <span role="status" style={{ color: 'var(--text-secondary)', fontSize: 'calc(12px * var(--ui-font-scale))' }}>已取消认证，SSH 连接已关闭</span>}
        {error && <span role="alert" style={{ color: 'var(--text-secondary)', fontSize: 'calc(12px * var(--ui-font-scale))' }}>{error}</span>}
      </div>}
    </div>
  );
}
