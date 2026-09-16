/**
 * InputEditor — 命令输入栏（对应文档 §7 输入框可见性状态机）。
 *
 * 每个 InputEditor 实例绑定一个 pane（未分屏 = 活跃标签 id；分屏后每个 pane 渲染各自的
 * 输入栏），text / AI 模式 / cwd / git 分支 / 提交路由都只针对该 pane，互不影响。
 *
 * ：
 *   ┌──────────────────────────────────────────────┐
 *   │ border-top (subtle，聚焦态无高亮)              │
 *   │  [shell胶囊] · ~/cwd · ⎇branch  [分屏][cmd/AI]│  ← prompt_elements
 *   │  $  [textarea.........................] ⤴ ✕  │  ← input_box
 *   └──────────────────────────────────────────────┘
 */

import { useRef, useState, useCallback, useEffect } from 'react';
import {
  ArrowUp, Columns2, GitBranch, Paperclip,
  ShieldAlert, ShieldCheck, ShieldOff, Square, X, Zap,
} from 'lucide-react';
import { ptyWrite } from '@/platform/pty';
import { useChatStore } from '@entities/chat';
import ContextRing from '@/components/ContextRing';
import { useUiStore } from '@shared/ui';
import { useSessionStore } from '@entities/session';
import { useInputStore, selectPaneInput } from '@entities/terminal';
import { getLongRunningHint } from '@features/terminal/inputVisibility';
import { useAgentSettings, usePermissions, useAttachmentComposer } from '@entities/agent';
import { completeCommand, localCompleteCandidates } from '@features/agent/services/complete';
import { useDockStore } from '@shared/ui';
import { engageFollow } from '@features/terminal/hooks/useFollowBottom';
import AttachmentChips from '@features/chat/components/AttachmentChips';
import ShellIndicator from '@features/terminal/components/ShellIndicator';
import { useCommandHistoryNavigation } from '@features/terminal/hooks/useCommandHistoryNavigation';
import { useTerminalInputContext } from '@features/terminal/hooks/useTerminalInputContext';

/** 权限模式循环（与 PanelChat 顶栏同款三色 Shield）：标准=逐工具 / 严格=逐次问 / 放行=直放 */
const PERM_MODES = [
  { id: 'standard', label: '标准', icon: ShieldCheck, color: 'var(--text-muted)', title: '标准权限：按设置页逐工具级别判定（点击切换）' },
  { id: 'strict', label: '严格', icon: ShieldAlert, color: 'var(--accent-warm)', title: '严格权限：所有工具操作逐次询问（点击切换）' },
  { id: 'relaxed', label: '放行', icon: ShieldOff, color: 'var(--error-light)', title: '放行模式：全部工具直接放行，危险命令仍会逐次询问（点击切换）' },
] as const;

interface Props {
  /** 该输入栏绑定的 pane（决定读写哪个终端） */
  paneId: string;
  /** 该 pane 是否为当前聚焦终端（未传时回退到 focusedPaneId 判定） */
  focused?: boolean;
  isLongRunning?: boolean;
  runningCommand?: string;
  onEndPress?: () => void;
  forceHidden?: boolean;
  /** 左右缩进（与命令块一致：内边 4 / 外缘 8） */
  insetLeft?: number;
  insetRight?: number;
}

export default function InputEditor({
  paneId,
  focused,
  isLongRunning,
  runningCommand,
  onEndPress,
  forceHidden,
  insetLeft = 8,
  insetRight = 8,
}: Props) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const chatSend = useChatStore((s) => s.send);

  const {
    sessions,
    isFocused,
    hasSession,
    pendingInput,
    setPendingInput,
    tabCwd,
    terminalLabel,
    recentGitBranch,
    visible,
  } = useTerminalInputContext({ paneId, focused, isLongRunning });

  // 每 pane 独立输入态（text + AI 模式）
  const input = useInputStore(selectPaneInput(paneId));
  const text = input.text;
  const aiMode = input.aiMode;
  const setText = useCallback(
    (t: string) => useInputStore.getState().setText(paneId, t),
    [paneId],
  );
  const setAiMode = useCallback(
    (m: boolean) => useInputStore.getState().setAiMode(paneId, m),
    [paneId],
  );

  // ── AI 模式扩展：与 AI 聊天面板对齐的发送/停止、快捷开关、权限、附件 ──
  const sendingTab = useChatStore((s) => s.sendingTab);
  const abortStream = useChatStore((s) => s.abortStream);
  const activeId = useSessionStore((s) => s.activeId);
  const sendingHere = sendingTab !== null && sendingTab === activeId;

  const permMode = usePermissions((s) => s.mode);
  const setPermMode = usePermissions((s) => s.setMode);

  const {
    attachments: atts,
    previewId,
    panelRef,
    addPastedText,
    pickFiles,
    addBlobs,
    togglePreview,
    removeAttachment,
    clearAttachments,
  } = useAttachmentComposer();

  const canSendAi = (!!text.trim() || atts.length > 0) && !sendingTab;

  // ── 消费 pendingInput ──

  useEffect(() => {
    if (pendingInput) {
      setText(text ? text + ' ' + pendingInput : pendingInput);
      setAiMode(false);
      setPendingInput('');
      inputRef.current?.focus();
    }
    // text/paneId 变化不重跑此 effect（只消费一次性 pendingInput）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingInput, setPendingInput, setText, setAiMode]);

  // 长运行结束输入栏重现时自动聚焦：运行期间焦点在块内活终端，
  // 块完成 dispose 后焦点掉回 body，不接管的话键盘无处可去
  const wasVisibleRef = useRef(visible);
  useEffect(() => {
    if (visible && !wasVisibleRef.current) inputRef.current?.focus();
    wasVisibleRef.current = visible;
  }, [visible]);

  // 焦点切换（⌘]/⌘[ 或点击 pane）时，把键盘焦点交给新聚焦终端的输入栏
  const wasFocusedRef = useRef(isFocused);
  useEffect(() => {
    if (isFocused && !wasFocusedRef.current && visible) inputRef.current?.focus();
    wasFocusedRef.current = isFocused;
  }, [isFocused, visible]);

  const resetHeight = useCallback(() => {
    if (inputRef.current) inputRef.current.style.height = 'auto';
  }, []);

  // ── 命令自动补全（M8 ghost text）──
  // 本地级（历史前缀/路径）零网络始终可用；AI 增强有 key 才叠加。
  // 本地历史前缀命中是同步即时反馈（零延迟体感）；本地未命中才防抖走路径/AI。
  // seq + AbortController 双保险防止过期建议落地。
  const completeOn = useAgentSettings((s) => s.global.completeEnabled);
  const completeDebounceMs = useAgentSettings((s) => s.global.completeDebounceMs);
  const [ghost, setGhost] = useState('');
  const [ghostCandidates, setGhostCandidates] = useState<string[]>([]);
  const ghostSeq = useRef(0);
  // 补全循环状态：base = 用户输入的原始前缀；candidates = 候选后缀；idx = 当前已接受下标
  const completionRef = useRef<{ base: string; candidates: string[]; idx: number } | null>(null);
  // Tab 提交会改写 text 触发 effect，用此标记跳过当次重算
  const suppressEffectRef = useRef(false);

  const clearGhost = useCallback(() => {
    ghostSeq.current++;
    completionRef.current = null;
    setGhost('');
    setGhostCandidates([]);
  }, []);

  useEffect(() => {
    if (suppressEffectRef.current) {
      suppressEffectRef.current = false;
      return; // Tab 提交引起的 text 变化，跳过重算
    }
    completionRef.current = null; // 用户正常输入，结束补全循环
    setGhost('');
    setGhostCandidates([]);
    if (
      !completeOn ||
      aiMode ||
      !isFocused ||
      !visible ||
      text.trim().length < 1 ||
      text.includes('\n')
    ) {
      return;
    }
    // 本地历史前缀：同步命中立即出全部候选 ghost（不等防抖）
    const locals = localCompleteCandidates(text);
    if (locals.length > 0) {
      setGhostCandidates(locals);
      setGhost(locals[0]!);
      return;
    }
    const seq = ++ghostSeq.current;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      completeCommand(text, { cwd: tabCwd }, ctrl.signal)
        .then((suffix) => {
          if (suffix && seq === ghostSeq.current && !ctrl.signal.aborted) {
            setGhostCandidates([suffix]);
            setGhost(suffix);
          }
        })
        .catch(() => {});
    }, completeDebounceMs);
    return () => {
      ctrl.abort();
      clearTimeout(timer);
    };
  }, [text, aiMode, completeOn, completeDebounceMs, isFocused, visible, tabCwd]);

  // ── ↑/↓ 翻命令历史（cmd 模式、单行时；fish 式按当前前缀过滤） ──
  // idx=-1 表示未在翻历史；base 记录开始翻之前的草稿，翻到底（ArrowDown 越界）还原
  const { reset: resetHistNav, navigate: navHistory } = useCommandHistoryNavigation({
    text,
    setText,
    inputRef,
    onNavigate: clearGhost,
  });

  // ── AI 面板开启时锁定 cmd 模式（AI 提问收口到面板；切换按钮显式禁用） ──
  const chatOpen = useDockStore((s) => s.leftPanels.includes('chat') || s.rightPanels.includes('chat'));
  useEffect(() => {
    if (chatOpen && aiMode) setAiMode(false);
  }, [chatOpen, aiMode, setAiMode]);

  const execute = useCallback(() => {
    const cmd = text.trim();
    // AI 模式允许「空文本 + 附件」发送（纯图片提问）；cmd 模式必须有命令
    if (aiMode ? (!cmd && atts.length === 0) || sendingTab : !cmd) return;
    useInputStore.getState().clearText(paneId);
    resetHeight();
    resetHistNav();
    try {
      if (aiMode) {
        // AI 模式：问题带上本 pane id —— 回答会内联进本 pane 的块流，同时进全局面板
        chatSend(cmd, { paneId, attachments: atts.length > 0 ? atts : undefined });
        clearAttachments();
      } else {
        const sid = sessions[paneId];
        if (sid) {
          ptyWrite(sid, cmd.endsWith('\n') ? cmd : cmd + '\n').catch(() => {});
        }
        engageFollow(paneId); // 提交新命令 = 明确回底意图
      }
    } catch (e) {
      console.error('[InputEditor] execute failed:', e);
    }
  }, [text, aiMode, atts, sendingTab, chatSend, paneId, sessions, resetHeight, resetHistNav, clearAttachments]);

  // ── 全局 End 键监听 ──

  useEffect(() => {
    if (!visible && onEndPress) {
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'End' && !e.ctrlKey && !e.metaKey && !e.altKey) {
          onEndPress();
        }
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }
  }, [visible, onEndPress]);

  // ── 长运行命令提示条 ──

  if (forceHidden) return null;

  if (!visible) {
    const hint = getLongRunningHint(runningCommand || '');
    return (
      <div
        ref={panelRef}
        style={{
          background: 'var(--block)',
          padding: '5px 16px',
          fontSize: 12,
          color: 'var(--text-secondary)',
          fontFamily: 'var(--font-mono)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          minHeight: 28,
        }}
      >
        <span
          style={{
            display: 'inline-block',
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: 'var(--accent-warm)',
            flexShrink: 0,
          }}
        />
        <span style={{ flex: 1 }}>{hint}</span>
        <span
          onClick={onEndPress}
          style={{
            fontSize: 10,
            padding: '1px 6px',
            border: '1px solid var(--border)',
            borderRadius: 3,
            background: 'transparent',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            fontFamily: 'var(--font-mono)',
          }}
        >
          End
        </span>
      </div>
    );
  }

  // ── 正常输入栏（卡片式：四周留缝 + 圆角卡片；prompt 元素下沉为底部状态栏） ──

  return (
    <div style={{ margin: '0.45em 0', padding: `0 ${insetRight}px 0 ${insetLeft}px` }}>
      <div
        style={{
          background: 'var(--block)',
          borderRadius: 12,
          padding: '8px 12px 5px',
          boxShadow: '0 1px 4px rgba(0, 0, 0, 0.22)',
        }}
        onDragOver={(e) => { if (aiMode) e.preventDefault(); }}
        onDrop={(e) => {
          if (!aiMode) return;
          e.preventDefault();
          void addBlobs(Array.from(e.dataTransfer.files));
        }}
      >

        {/* 附件 chips（仅 AI 模式，随发送清空） */}
        {aiMode && atts.length > 0 && (
          <AttachmentChips
            atts={atts}
            previewId={previewId}
            onPreview={togglePreview}
            onRemove={removeAttachment}
          />
        )}

        {/* 输入行 — $/⚡ prompt + textarea + ghost overlay */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          {/* Prompt 字符 — 点击切换模式（AI 面板开启时锁定 cmd，显式禁用）
              固定 24px 高 + flex 居中，与 textarea（22px 行高 + 1px 上下 padding）精确对齐 */}
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 13,
              fontWeight: 600,
              minWidth: 16,
              height: 24,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              color: aiMode ? 'var(--accent-warm)' : 'var(--accent)',
              userSelect: 'none',
              lineHeight: 1,
              cursor: chatOpen ? 'not-allowed' : 'pointer',
              opacity: chatOpen ? 0.45 : 1,
            }}
            onClick={() => {
              if (!chatOpen) setAiMode(!aiMode);
            }}
            title={
              chatOpen
                ? 'AI 对话面板开启中，请在面板中提问'
                : aiMode
                  ? '切回命令模式'
                  : '切换到 AI 模式'
            }
          >
            {aiMode ? <Zap size={13} /> : '$'}
          </span>

          {/* textarea + ghost overlay（绝对定位同字体同内边距，透明已输入 + muted 建议后缀）
              display:flex 让 textarea 成为 flex item，消除 inline-block 基线下方空隙（否则容器比 textarea 高 7px） */}
          <div style={{ position: 'relative', flex: 1, minWidth: 0, display: 'flex' }}>
            <textarea
              ref={inputRef}
              value={text}
              placeholder={aiMode ? '自然语言描述你想做什么…' : '输入命令…'}
              rows={1}
              onChange={(e) => {
                resetHistNav();
                setText(e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
              }}
              onPaste={(e) => {
                // AI 模式：图片/文件粘贴为附件；长文本折叠为 chip
                if (!aiMode) return;
                const files = Array.from(e.clipboardData.files);
                if (files.length > 0) {
                  e.preventDefault();
                  void addBlobs(files);
                  return;
                }
                const t = e.clipboardData.getData('text/plain');
                if (t && addPastedText(t)) e.preventDefault();
              }}
              onKeyDown={(e) => {
                // ↑/↓ 翻命令历史（cmd 模式 + 单行；fish 式按当前前缀过滤）
                if (!aiMode && !text.includes('\n') && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                  if (navHistory(e.key === 'ArrowUp' ? 1 : -1)) {
                    e.preventDefault();
                    return;
                  }
                }
                // Tab 接受当前候选；再按 Tab 替换为下一个命令（Shift+Tab 后退）；Esc 丢弃
                if (e.key === 'Tab' && (ghostCandidates.length > 0 || completionRef.current)) {
                  e.preventDefault();
                  resetHistNav();
                  const cycle = completionRef.current;
                  if (cycle) {
                    // 已在循环中：替换为下一个 / 上一个候选
                    const dir = e.shiftKey ? -1 : 1;
                    cycle.idx = (cycle.idx + dir + cycle.candidates.length) % cycle.candidates.length;
                    suppressEffectRef.current = true;
                    setText(cycle.base + cycle.candidates[cycle.idx]!);
                  } else {
                    // 首次 Tab：接受第一个候选，进入循环
                    completionRef.current = { base: text, candidates: ghostCandidates, idx: 0 };
                    suppressEffectRef.current = true;
                    setText(text + ghostCandidates[0]!);
                    setGhost('');
                    setGhostCandidates([]);
                  }
                  const el = inputRef.current;
                  if (el) {
                    el.style.height = 'auto';
                    requestAnimationFrame(() => {
                      el.style.height = Math.min(el.scrollHeight, 120) + 'px';
                    });
                  }
                  return;
                }
                if (e.key === 'Escape') {
                  const cycle = completionRef.current;
                  if (cycle) {
                    // 补全循环中：Esc 还原到原始前缀
                    suppressEffectRef.current = true;
                    setText(cycle.base);
                    clearGhost();
                    return;
                  }
                  if (ghost) {
                    clearGhost();
                    return;
                  }
                  if (text) {
                    setText('');
                    resetHeight();
                  } else if (aiMode && !chatOpen) setAiMode(false);
                }
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  clearGhost();
                  execute();
                }
              }}
              style={{
                position: 'relative',
                zIndex: 1,
                flex: 1,
                minWidth: 0,
                resize: 'none',
                background: 'transparent',
                border: 'none',
                padding: '1px 0',
                fontSize: 13,
                fontFamily: 'var(--font-mono)',
                color: 'var(--text-primary)',
                lineHeight: '22px',
                outline: 'none',
              }}
            />
            {ghost && (
              <div
                aria-hidden
                style={{
                  position: 'absolute',
                  inset: 0,
                  zIndex: 0,
                  pointerEvents: 'none',
                  padding: '1px 0',
                  fontSize: 13,
                  fontFamily: 'var(--font-mono)',
                  lineHeight: '22px',
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'break-word',
                }}
              >
                <span style={{ color: 'transparent' }}>{text}</span>
                <span style={{ color: 'var(--text-muted)', opacity: 0.6 }}>{ghost}</span>
              </div>
            )}
          </div>

          {/* 上下文占用 + 发送/停止按钮（仅 AI 模式） */}
          {aiMode && (
            <>
              <span style={{ marginRight: 6, display: 'inline-flex', alignItems: 'center' }}>
                <ContextRing />
              </span>
              {sendingHere ? (
              <button
                data-subtle
                title="停止生成"
                onClick={() => abortStream(activeId)}
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 24, height: 24, padding: 0, border: 'none', borderRadius: 4,
                  background: 'transparent', color: 'var(--accent-warm)', cursor: 'pointer', flexShrink: 0,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--button-hover)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                <Square size={11} fill="currentColor" />
              </button>
            ) : (
              <button
                data-subtle
                title="发送 (Enter)"
                onClick={execute}
                disabled={!canSendAi}
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 24, height: 24, padding: 0, border: 'none', borderRadius: 4,
                  background: 'transparent',
                  color: canSendAi ? 'var(--accent-warm)' : 'var(--text-muted)',
                  cursor: canSendAi ? 'pointer' : 'default', flexShrink: 0,
                }}
                onMouseEnter={(e) => { if (canSendAi) e.currentTarget.style.background = 'var(--button-hover)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                <ArrowUp size={13} />
              </button>
            )}
            </>
          )}
        </div>

        {/* 底部状态栏 — shell · CWD · git分支 | cmd/AI pill · 分裂 · 关闭 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            minHeight: 22,
            marginTop: 4,
            paddingTop: 5,
            fontSize: 11,
            color: 'var(--text-muted)',
            userSelect: 'none',
          }}
        >
          <ShellIndicator connected={hasSession} focused={isFocused} label={terminalLabel} />
          <span style={{ color: 'var(--border-strong)', opacity: 0.5, margin: '0 1px' }}>·</span>
          <CurrentDir dir={tabCwd} />
          {recentGitBranch && (
            <>
              <span style={{ color: 'var(--border-strong)', opacity: 0.5, margin: '0 1px' }}>·</span>
              <GitBranchLabel branch={recentGitBranch} />
            </>
          )}
          <div style={{ flex: 1 }} />
          {/* AI / cmd 模式 pill（AI 面板开启时锁定 cmd，显式禁用） */}
          <button
            onClick={() => {
              if (!chatOpen) setAiMode(!aiMode);
            }}
            title={
              chatOpen ? 'AI 对话面板开启中，请在面板中提问' : aiMode ? '切回命令模式' : '切换到 AI 模式'
            }
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              fontWeight: 500,
              padding: '1px 8px',
              border: '1px solid var(--border)',
              borderRadius: 4,
              background: aiMode ? 'var(--accent-warm-dim)' : 'transparent',
              color: aiMode ? 'var(--accent-warm)' : 'var(--text-muted)',
              cursor: chatOpen ? 'not-allowed' : 'pointer',
              opacity: chatOpen ? 0.45 : 1,
              lineHeight: '16px',
              transition: 'background 0.12s ease, color 0.12s ease',
            }}
          >
            {aiMode ? 'AI' : 'cmd'}
          </button>
          {!aiMode && (
            <>
              <InputActionBtn title="选择类型分裂" onClick={() => useUiStore.getState().openSplitPicker()}>
                <Columns2 size={13} />
              </InputActionBtn>
              <InputActionBtn title="关闭当前终端" onClick={() => useSessionStore.getState().closeTerminal(paneId)}>
                <X size={13} />
              </InputActionBtn>
            </>
          )}
          {aiMode && (
            <>
              {(() => {
                const idx = PERM_MODES.findIndex((m) => m.id === permMode);
                const cur = PERM_MODES[idx] ?? PERM_MODES[0]!;
                const next = PERM_MODES[(idx + 1) % PERM_MODES.length]!;
                const CurIcon = cur.icon;
                return (
                  <button
                    data-subtle
                    title={cur.title}
                    onClick={() => setPermMode(next.id)}
                    style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      width: 24, height: 24, padding: 0, border: 'none', borderRadius: 4,
                      background: 'transparent', color: cur.color, cursor: 'pointer',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--button-hover)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    <CurIcon size={13} />
                  </button>
                );
              })()}
              <button
                data-subtle
                title="添加附件（图片 / 文件，也可直接粘贴或拖入）"
                onClick={() => void pickFiles()}
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 24, height: 24, padding: 0, border: 'none', borderRadius: 4,
                  background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--button-hover)';
                  e.currentTarget.style.color = 'var(--text-secondary)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = 'var(--text-muted)';
                }}
              >
                <Paperclip size={13} />
              </button>
            </>
          )}
        </div>
      </div>

    </div>
  );
}

/** 输入栏小按钮（状态栏右侧：分裂/关闭） */
function InputActionBtn({ title, onClick, children }: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      data-subtle
      title={title}
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 24, height: 24, padding: 0, border: 'none', borderRadius: 4,
        background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', flexShrink: 0,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--button-hover)';
        e.currentTarget.style.color = 'var(--text-secondary)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.color = 'var(--text-muted)';
      }}
    >
      {children}
    </button>
  );
}

// ── 工作目录 ──

/** 当前目录标签（mono 11px）；导出给 PanelChat 的 prompt 行复用，保证两处一致 */
export function CurrentDir({ dir }: { dir?: string }) {
  const label = dir
    ? dir.startsWith('/') && dir.length > 20
      ? '…' + dir.slice(-19)
      : dir.slice(1)
    : '~/project';
  return (
    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)' }}>
      {label}
    </span>
  );
}

// ── Git 分支标签 ──

function GitBranchLabel({ branch }: { branch: string }) {
  const label = branch.length > 22 ? branch.slice(0, 21) + '…' : branch;
  return (
    <span
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        color: 'var(--accent-warm)',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 2,
      }}
    >
      <GitBranch size={10} style={{ opacity: 0.6 }} />
      {label}
    </span>
  );
}
