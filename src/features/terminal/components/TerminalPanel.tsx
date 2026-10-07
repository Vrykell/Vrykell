import '@xterm/xterm/css/xterm.css';
import { useTerminalSession } from '../hooks/useTerminalSession';
import { useEffect, useRef, useState } from 'react';
import { useTerminalStore } from '@features/terminal';
import { ptyWrite } from '@platform/pty';
import ErrorBox from '@ui/ErrorBox';
import Select from '@ui/Select';
import { secretResponsePrompt, secretResponseWasRejected } from '../model/terminalFrame';
import { t } from '@i18n';
import { terminalDebug } from '../services/terminalDebug';

/** Render an interactive SSH session with xterm so screen contents and cursor stay in sync. */
export default function TerminalPanel({ paneId, tabId, onReady, connectionInput = false, sshTarget }: {
  paneId: string; tabId: string; onReady: (sessionId: string) => void; connectionInput?: boolean;
  /** 连接页状态行显示的目标（用户@主机），由标签的 SSH 目标传入。 */
  sshTarget?: string;
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
  // 断开后不再铺满屏快照：状态块里保留最后几行输出，原因就来自 ssh 自己的输出
  const showSnapshot = !disconnected && !manualSecret && secret && secretPrompt !== null;
  const stateLabel = cancellation === 'done'
    ? (cancelledAuthentication ? t('ssh.state.authCancelled') : t('ssh.state.manualClosed'))
    : disconnected ? t('ssh.state.disconnected')
      : status === 'connecting' ? t('ssh.state.connecting')
        : secret ? t('ssh.state.authenticating')
          : t('ssh.state.connected');
  const stateColor = disconnected ? 'var(--error)' : (secret || status === 'connecting') ? 'var(--accent-warm)' : 'var(--accent)';
  // 主动取消时状态行已经说明了原因，不重复
  const endReason = cancellation === 'done' ? null : status === 'error' ? t('ssh.ended.failed') : status === 'closed' ? t('ssh.ended.exited') : null;
  const outputTail = disconnected ? text.split('\n').map((line) => line.trimEnd()).filter((line) => line.trim().length > 0).slice(-8).join('\n') : '';
  const cardOutput = disconnected ? [outputTail, exitNoticeShown ? '' : exitNotice].filter(Boolean).join('\n') : '';
  // 选择器显示「现在用哪种输入」：输密码框可见就是密码输入，否则是直接输入
  const inputMode = secret ? 'secret' : 'direct';
  return <div style={{ width: '100%', height: '100%', position: 'relative' }}>
    {!connectionInput && <div ref={ref} style={{ position: 'absolute', inset: 0, minHeight: 0, background: 'transparent', paddingLeft: 8 }} />}
    {connectionInput && <div data-testid="ssh-connection-input" style={{ position: 'absolute', inset: 0, display: interactive ? 'flex' : 'none', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0, padding: '4px 8px', fontSize: 'calc(12px * var(--ui-font-scale))' }}>
        <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: stateColor }} />
        <span role="status" style={{ color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>{stateLabel}</span>
        {sshTarget && <span style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sshTarget}</span>}
        <span style={{ flex: 1 }} />
        {/* 输入方式：显式单选，不再用会翻转文字的按钮 */}
        {!disconnected && sessionId && (
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
            style={{ height: 26, minWidth: 108, fontSize: 'calc(12px * var(--ui-font-scale))' }}
          />
        )}
        {!disconnected && <button type="button" disabled={inputDisabled} onClick={() => void cancelAuthentication()} style={{ padding: '7px 12px' }}>{cancellation === 'pending' ? t('ssh.action.cancelling') : secret ? t('ssh.action.cancelAuth') : status === 'connecting' ? t('ssh.action.cancelConnect') : t('ssh.action.disconnect')}</button>}
      </div>
      {/* 终端区常驻：xterm 宿主必须一直在，否则重连时没有宿主可挂载。
          断开后屏幕隐藏、由 ErrorBox 接管；aria-disabled 只在断开以外设置，
          否则内嵌的重连按钮会被辅助技术当成禁用 */}
      <div role="textbox" aria-label="SSH 交互终端" aria-multiline="true"
        aria-disabled={disconnected ? undefined : (inputDisabled || secret)} tabIndex={inputDisabled || secret ? -1 : 0}
        onFocus={focusTerminal} onMouseDown={focusTerminal} style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'auto', outline: 'none', cursor: 'text' }}>
        {/* 密码框开着（secret）时屏幕只读，点它也不会把输入交给终端 */}
        <div ref={ref} data-testid={showSnapshot ? undefined : 'ssh-terminal-screen'} style={{ position: 'absolute', inset: 0, overflow: 'auto', visibility: showSnapshot || disconnected ? 'hidden' : 'visible', pointerEvents: showSnapshot || disconnected || secret ? 'none' : 'auto', paddingLeft: 8 }} />
        {showSnapshot && <pre data-testid="ssh-terminal-screen" style={{ position: 'absolute', inset: 0, overflow: 'auto', margin: 0, whiteSpace: 'pre', color: 'var(--text-primary)', paddingLeft: 8 }} dangerouslySetInnerHTML={{ __html: frame?.html || '正在连接远端主机…' }} />}
        {/* 连接中：居中转圈 + 细进度条（不写解释性小字） */}
        {!disconnected && status === 'connecting' && (
          <div data-testid="ssh-connecting" aria-hidden="true" style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, pointerEvents: 'none' }}>
            <span className="ssh-connect-spinner" />
            <span style={{ fontSize: 'calc(14px * var(--ui-font-scale))', color: 'var(--text-primary)' }}>{t('ssh.connecting.to', { target: sshTarget ?? '' })}</span>
            <span className="ssh-connect-progress"><i /></span>
          </div>
        )}
        {/* 连接已结束：与文件面板的远端失败页共用 ErrorBox（标题 + 原因 + 动作 + 最后输出） */}
        {disconnected && (
          <ErrorBox
            testId="ssh-connection-ended"
            style={{ position: 'relative', zIndex: 1, margin: '0 8px 8px', maxWidth: 640 }}
            title={t('ssh.ended.title')}
            actions={<button type="button" disabled={cancellation === 'pending'} onClick={() => void restart()} style={{ minHeight: 32 }}>{t('ssh.action.reconnect')}</button>}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div>{endReason ?? t('ssh.ended.cancelled')}</div>
              {cardOutput && <>
                <div style={{ fontSize: 'var(--fs-micro)', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>{t('ssh.ended.lastOutput')}</div>
                <pre data-selectable style={{ margin: 0, padding: '10px 12px', background: 'var(--xterm-bg)', border: '1px solid var(--border)', borderRadius: 6, fontFamily: 'var(--font-mono)', fontSize: 'calc(12px * var(--ui-font-scale))', lineHeight: 1.55, color: 'var(--xterm-fg)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{cardOutput}</pre>
              </>}
            </div>
          </ErrorBox>
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
          <input ref={responseRef} type="password" autoComplete="off" aria-label="SSH 认证响应" placeholder="输入密码、密钥口令或验证响应" value={response} onChange={e => setResponse(e.target.value)} disabled={inputDisabled} className="ssh-auth-response" style={{ flex: 1, minWidth: 0, height: 36, background: 'transparent', border: 'none', outline: 'none' }} />
          <button type="submit" disabled={inputDisabled} style={{ padding: '8px 16px' }}>发送</button>
        </form>
      </div>}
      {error && <ErrorBox compact style={{ flexShrink: 0 }}>{error}</ErrorBox>}
    </div>}
  </div>;
}
