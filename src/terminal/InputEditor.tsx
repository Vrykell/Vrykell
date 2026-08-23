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

import { useRef, useState, useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { Columns2, GitBranch, X, Zap } from 'lucide-react';
import { ptyWrite } from '../lib/pty';
import { useTerminalStore } from '../stores/terminal';
import { useChatStore } from '../stores/chat';
import { useUiStore } from '../stores/ui';
import { useWorkspaceStore, isSessionTab } from '../stores/workspace';
import { leaves as layoutLeaves } from '../lib/windowLayout';
import { shellTypeLabel } from '../lib/shells';
import { useBlockStore } from '../stores/blocks';
import { useInputStore, selectPaneInput } from '../stores/input';
import { isInputBoxVisible, getLongRunningHint } from './inputVisibility';
import { agentControl } from '../agent/agentControl';
import { useAgentSettings } from '../agent/agentSettings';
import { completeCommand, localComplete } from '../agent/complete';
import { useHistoryStore } from '../stores/history';
import { useDockStore } from '../stores/dock';
import { engageFollow } from './useFollowBottom';
import ShellIndicator from './ShellIndicator';

interface Props {
  /** 该输入栏绑定的 pane（决定读写哪个终端） */
  paneId: string;
  /** 该 pane 是否为当前聚焦终端（未传时回退到 focusedPaneId 判定） */
  focused?: boolean;
  isLongRunning?: boolean;
  runningCommand?: string;
  onEndPress?: () => void;
  forceHidden?: boolean;
}

export default function InputEditor({
  paneId,
  focused,
  isLongRunning,
  runningCommand,
  onEndPress,
  forceHidden,
}: Props) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const chatSend = useChatStore((s) => s.send);

  const sessions = useTerminalStore((s) => s.sessions);
  const focusedPaneId = useTerminalStore((s) => s.focusedPaneId);
  const isFocused = focused ?? paneId === focusedPaneId;

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

  // 场景 / 连接态按聚焦 pane 读取（分屏时每 pane 各自的状态机）
  const scene = useTerminalStore((s) => s.scenes[paneId] ?? 'classic');
  const altScreenActive = scene === 'altScreen';
  const hasSession = !!sessions[paneId];
  const pendingInput = useTerminalStore((s) => s.pendingInput);
  const setPendingInput = useTerminalStore((s) => s.setPendingInput);

  const tabCwd = useWorkspaceStore((s) => {
    const at = s.tabs.find((x) => x.id === s.activeId);
    if (at && isSessionTab(at)) {
      const spec = layoutLeaves(at.layout).find((t) => t.id === paneId);
      return s.terminalCwds[paneId] ?? spec?.cwd;
    }
    return undefined;
  });

  const terminalLabel = useWorkspaceStore((s) => {
    const at = s.tabs.find((x) => x.id === s.activeId);
    if (at && isSessionTab(at)) {
      const spec = layoutLeaves(at.layout).find((t) => t.id === paneId);
      if (spec?.kind === 'ssh') return spec.ssh?.name || spec.ssh?.host || 'SSH';
      return spec?.shellType ? shellTypeLabel(spec.shellType) : '本地';
    }
    return undefined;
  });

  // 从最近完成的 block 中读取 git 分支信息（聚焦 pane 的块）
  const recentGitBranch = useBlockStore((s) => {
    const blocks = s.byTab[paneId] ?? [];
    for (let i = blocks.length - 1; i >= 0; i--) {
      if (blocks[i]?.gitBranch) return blocks[i]!.gitBranch!;
    }
    return null;
  });

  // ── 输入框可见性状态机（§7） ──

  // agent 正在本 pane 执行命令时输入栏保持可见（接通 isAgentInControl 预留位）
  const isAgentInControl = useSyncExternalStore(agentControl.subscribe, () =>
    agentControl.isControlled(paneId),
  );

  const visible = useMemo(
    () =>
      isInputBoxVisible({
        isReadOnly: false,
        isAltScreenActive: altScreenActive,
        isLongRunning: isLongRunning ?? false,
        isAgentInControl,
        isAgentTaggedIn: false,
      }),
    [altScreenActive, isLongRunning, isAgentInControl],
  );

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
  const completeOn = useAgentSettings((s) => s.completeEnabled);
  const completeDebounceMs = useAgentSettings((s) => s.completeDebounceMs);
  const [ghost, setGhost] = useState('');
  const ghostSeq = useRef(0);

  const clearGhost = useCallback(() => {
    ghostSeq.current++;
    setGhost('');
  }, []);

  useEffect(() => {
    setGhost('');
    if (
      !completeOn ||
      aiMode ||
      !isFocused ||
      !visible ||
      text.trim().length < 2 ||
      text.includes('\n')
    ) {
      return;
    }
    // 本地历史前缀：同步命中立即出 ghost（不等防抖）
    const local = localComplete(text);
    if (local) {
      setGhost(local);
      return;
    }
    const seq = ++ghostSeq.current;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      completeCommand(text, { cwd: tabCwd }, ctrl.signal)
        .then((suffix) => {
          if (suffix && seq === ghostSeq.current && !ctrl.signal.aborted) setGhost(suffix);
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
  const histNav = useRef<{ idx: number; base: string }>({ idx: -1, base: '' });
  const resetHistNav = useCallback(() => {
    histNav.current = { idx: -1, base: '' };
  }, []);

  const navHistory = useCallback(
    (dir: 1 | -1) => {
      const entries = useHistoryStore.getState().entries;
      const nav = histNav.current;
      const base = nav.idx === -1 ? text : nav.base;
      const candidates = entries.filter(
        (e) => e.command.startsWith(base) && e.command.length > base.length,
      );
      const next = nav.idx + dir;
      if (next < -1 || next >= candidates.length) return false;
      histNav.current = { idx: next, base };
      setText(next === -1 ? base : candidates[next]!.command);
      clearGhost();
      // 光标移到行尾（受控 textarea 更新后光标停在原处）
      const el = inputRef.current;
      if (el) {
        requestAnimationFrame(() => {
          el.selectionStart = el.selectionEnd = el.value.length;
        });
      }
      return true;
    },
    [text, setText, clearGhost],
  );

  // ── AI 面板开启时锁定 cmd 模式（AI 提问收口到面板；切换按钮显式禁用） ──
  const chatOpen = useDockStore((s) => s.leftPanels.includes('chat') || s.rightPanels.includes('chat'));
  useEffect(() => {
    if (chatOpen && aiMode) setAiMode(false);
  }, [chatOpen, aiMode, setAiMode]);

  const execute = useCallback(() => {
    const cmd = text.trim();
    if (!cmd) return;
    useInputStore.getState().clearText(paneId);
    resetHeight();
    resetHistNav();
    try {
      if (aiMode) {
        // AI 模式：问题带上本 pane id —— 回答会内联进本 pane 的块流，同时进全局面板
        chatSend(cmd, { paneId });
      } else {
        const sid = sessions[paneId];
        if (sid) ptyWrite(sid, cmd.endsWith('\n') ? cmd : cmd + '\n').catch(() => {});
        engageFollow(paneId); // 提交新命令 = 明确回底意图
      }
    } catch (e) {
      console.error('[InputEditor] execute failed:', e);
    }
  }, [text, aiMode, chatSend, paneId, sessions, resetHeight, resetHistNav]);

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
        style={{
          borderTop: '1px solid var(--border)',
          background: 'var(--surface)',
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
    <div style={{ padding: '0 10px 10px' }}>
      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: '8px 12px 5px',
          boxShadow: '0 1px 4px rgba(0, 0, 0, 0.22)',
        }}
      >
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
              onKeyDown={(e) => {
                // ↑/↓ 翻命令历史（cmd 模式 + 单行；fish 式按当前前缀过滤）
                if (!aiMode && !text.includes('\n') && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                  if (navHistory(e.key === 'ArrowUp' ? 1 : -1)) {
                    e.preventDefault();
                    return;
                  }
                }
                // Tab 接受建议 / Esc 丢弃建议（优先于清空文本）
                if (ghost && e.key === 'Tab') {
                  e.preventDefault();
                  setText(text + ghost);
                  clearGhost();
                  resetHistNav();
                  const el = inputRef.current;
                  if (el) {
                    el.style.height = 'auto';
                    requestAnimationFrame(() => {
                      el.style.height = Math.min(el.scrollHeight, 120) + 'px';
                    });
                  }
                  return;
                }
                if (ghost && e.key === 'Escape') {
                  clearGhost();
                  return;
                }
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  clearGhost();
                  execute();
                }
                if (e.key === 'Escape') {
                  if (text) {
                    setText('');
                    resetHeight();
                  } else if (aiMode && !chatOpen) setAiMode(false);
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
            borderTop: '1px solid var(--border)',
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
          <InputActionBtn title="选择类型分裂" onClick={() => useUiStore.getState().openSplitPicker()}>
            <Columns2 size={13} />
          </InputActionBtn>
          <InputActionBtn title="关闭当前终端" onClick={() => useWorkspaceStore.getState().closeTerminal(paneId)}>
            <X size={13} />
          </InputActionBtn>
        </div>
      </div>
    </div>
  );
}

// ── 操作按钮 ──

function InputActionBtn({
  title,
  onClick,
  children,
}: {
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
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 24,
        height: 24,
        padding: 0,
        border: 'none',
        borderRadius: 4,
        background: 'transparent',
        color: 'var(--text-muted)',
        fontSize: 12,
        cursor: 'pointer',
        flexShrink: 0,
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
