/**
 * PanelChat — 全局 AI 对话面板（dock 面板，「会话转录」形态）。
 *
 * 与块流内联块共享同一份数据（chat store）：这里是全窗口视角的转录，
 * 跨 pane 的问答按来源 pane 分段，段首是 mono 标签（shell · cwd）。
 * 底部输入栏与终端 InputEditor 完全同构（prompt 行 + ⚡ 输入行，同度量），
 * 发送目标是当前聚焦 pane。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Zap } from 'lucide-react';
import { useChatStore, useActiveMessages } from '../stores/chat';
import { useWorkspaceStore, isSessionTab } from '../stores/workspace';
import { useTerminalStore } from '../stores/terminal';
import { leaves as layoutLeaves, firstLeaf } from '../lib/windowLayout';
import { shellTypeLabel } from '../lib/shells';
import ShellIndicator from '../terminal/ShellIndicator';
import { CurrentDir } from '../terminal/InputEditor';
import AiBlock from './AiBlock';
import { toExchanges, type ChatExchange } from './exchanges';

export default function PanelChat() {
  const messages = useActiveMessages();
  const send = useChatStore((s) => s.send);
  const sending = useChatStore((s) => s.sendingTab !== null);

  const activeTab = useWorkspaceStore((s) => s.tabs.find((t) => t.id === s.activeId));
  const cwds = useWorkspaceStore((s) => s.terminalCwds);
  const focusedPaneId = useTerminalStore((s) => s.focusedPaneId);
  const sessions = useTerminalStore((s) => s.sessions);
  const isSession = !!activeTab && isSessionTab(activeTab);

  const [text, setText] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const exchanges = useMemo(() => toExchanges(messages), [messages]);

  // 新内容（条数变化 / 流式增长）时吸底
  const lastLen = messages[messages.length - 1]?.content.length ?? 0;
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, lastLen]);

  /** pane → shell/cwd 分量（prompt 行用）；无 paneId 的旧消息返回 null（归「本窗口」） */
  const paneInfo = (paneId?: string): { shell: string; cwd?: string } | null => {
    if (!paneId || !activeTab || !isSessionTab(activeTab)) return null;
    const spec = layoutLeaves(activeTab.layout).find((t) => t.id === paneId);
    if (!spec) return null;
    const shell = spec.kind === 'ssh'
      ? spec.ssh?.name || spec.ssh?.host || 'SSH'
      : spec.shellType ? shellTypeLabel(spec.shellType) : '本地';
    return { shell, cwd: cwds[paneId] ?? spec.cwd };
  };

  /** pane → 分段标签（shell · cwd），无 paneId 的旧消息归入「本窗口」 */
  const paneLabel = (paneId?: string): string => {
    const info = paneInfo(paneId);
    if (!info) return '本窗口';
    const dir = info.cwd
      ? info.cwd.startsWith('/') && info.cwd.length > 20
        ? '…' + info.cwd.slice(-19)
        : info.cwd.slice(1)
      : '';
    return dir ? `${info.shell} · ${dir}` : info.shell;
  };

  // 发送目标 = 当前聚焦 pane（回退到布局第一个 pane）
  const targetPane = isSession && activeTab && isSessionTab(activeTab)
    ? (focusedPaneId && layoutLeaves(activeTab.layout).some((t) => t.id === focusedPaneId)
        ? focusedPaneId
        : firstLeaf(activeTab.layout).id)
    : undefined;

  const submit = () => {
    const q = text.trim();
    if (!q || sending || !isSession) return;
    setText('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
    send(q, { paneId: targetPane });
  };

  // 目标 pane 的显示分量（prompt 行镜像终端输入栏：shell 胶囊 · cwd）
  const targetInfo = paneInfo(targetPane);
  const targetConnected = targetPane ? !!sessions[targetPane] : false;
  const targetFocused = !!targetPane && targetPane === focusedPaneId;
  const canSend = !!text.trim() && !sending && isSession;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* 转录区：按来源 pane 分段（无独立顶栏，面板身份由 dock 按钮承担） */}
      <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 8px 8px' }}>
        {exchanges.length === 0 ? (
          <EmptyHint isSession={isSession} />
        ) : (
          <Transcript exchanges={exchanges} paneLabel={paneLabel} />
        )}
      </div>

      {/* 输入栏：与终端 InputEditor 同结构同度量（prompt 行 + ⚡ 输入行） */}
      {isSession && (
        <div style={{
          flexShrink: 0,
          borderTop: '1px solid var(--border)',
          background: 'var(--surface)',
          padding: '6px 16px 8px',
        }}>
          {/* prompt_elements 行：目标 pane 上下文（镜像终端输入栏：shell 胶囊 · cwd | AI 标记） */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            minHeight: 22, fontSize: 11, color: 'var(--text-muted)', userSelect: 'none',
          }}>
            <ShellIndicator connected={targetConnected} focused={targetFocused} label={targetInfo?.shell ?? '本地'} />
            {targetInfo?.cwd && (
              <>
                <span style={{ color: 'var(--border-strong)', opacity: 0.5, margin: '0 1px' }}>·</span>
                <CurrentDir dir={targetInfo.cwd} />
              </>
            )}
            <div style={{ flex: 1 }} />
            {/* 静态 AI 标记 — 位置对应终端输入栏的 cmd/AI 模式 pill */}
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              fontWeight: 500,
              padding: '1px 8px',
              border: '1px solid var(--border)',
              borderRadius: 4,
              background: 'var(--accent-warm-dim)',
              color: 'var(--accent-warm)',
              lineHeight: '16px',
            }}>
              AI
            </span>
          </div>

          {/* 输入行：⚡ prompt + textarea + 发送按钮（度量同 InputEditor） */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 6 }}>
            <span style={{
              minWidth: 16, textAlign: 'center', lineHeight: '24px',
              color: 'var(--accent-warm)', userSelect: 'none', flexShrink: 0,
              display: 'inline-flex', justifyContent: 'center',
            }}>
              <Zap size={13} />
            </span>
            <textarea
              ref={inputRef}
              value={text}
              placeholder="自然语言描述你想做什么…"
              rows={1}
              onChange={(e) => {
                setText(e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submit();
                }
                if (e.key === 'Escape') setText('');
              }}
              style={{
                flex: 1, minWidth: 0, resize: 'none',
                background: 'transparent', border: 'none', padding: '1px 0',
                fontSize: 13, fontFamily: 'var(--font-mono)',
                color: 'var(--text-primary)', lineHeight: '22px', outline: 'none',
              }}
            />
            {/* 发送按钮 — 位置/尺寸对应终端输入栏右侧的操作按钮 */}
            <button
              data-subtle
              title="发送 (Enter)"
              onClick={submit}
              disabled={!canSend}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 24,
                height: 24,
                padding: 0,
                border: 'none',
                borderRadius: 4,
                background: 'transparent',
                color: canSend ? 'var(--accent-warm)' : 'var(--text-muted)',
                cursor: canSend ? 'pointer' : 'default',
                flexShrink: 0,
              }}
              onMouseEnter={(e) => {
                if (!canSend) return;
                e.currentTarget.style.background = 'var(--button-hover)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
              }}
            >
              <ArrowUp size={13} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** 转录：连续同 pane 的交换归一段，段首 mono 标签（样式同面板分组标签） */
function Transcript({ exchanges, paneLabel }: {
  exchanges: ChatExchange[];
  paneLabel: (paneId?: string) => string;
}) {
  let lastPane: string | undefined | null = null;
  return (
    <>
      {exchanges.map((ex) => {
        const showTag = ex.paneId !== lastPane;
        lastPane = ex.paneId;
        return (
          <div key={ex.id}>
            {showTag && (
              <div style={{
                fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)',
                padding: '10px 4px 2px', userSelect: 'none',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {paneLabel(ex.paneId)}
              </div>
            )}
            <AiBlock exchange={ex} />
          </div>
        );
      })}
    </>
  );
}

function EmptyHint({ isSession }: { isSession: boolean }) {
  return (
    <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12, userSelect: 'none' }}>
      {isSession ? '描述问题，Enter 发送' : '打开一个终端会话开始对话'}
    </div>
  );
}
