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

import { useRef, useCallback, useEffect, useMemo } from 'react';
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

  const visible = useMemo(
    () =>
      isInputBoxVisible({
        isReadOnly: false,
        isAltScreenActive: altScreenActive,
        isLongRunning: isLongRunning ?? false,
        isAgentInControl: false,
        isAgentTaggedIn: false,
      }),
    [altScreenActive, isLongRunning],
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

  const execute = useCallback(() => {
    const cmd = text.trim();
    if (!cmd) return;
    useInputStore.getState().clearText(paneId);
    resetHeight();
    try {
      if (aiMode) {
        chatSend(cmd);
      } else {
        const sid = sessions[paneId];
        if (sid) ptyWrite(sid, cmd.endsWith('\n') ? cmd : cmd + '\n').catch(() => {});
        engageFollow(paneId); // 提交新命令 = 明确回底意图
      }
    } catch (e) {
      console.error('[InputEditor] execute failed:', e);
    }
  }, [text, aiMode, chatSend, paneId, sessions, resetHeight]);

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

  // ── 正常输入栏 ──

  return (
    <div
      style={{
        borderTop: '1px solid var(--border)',
        background: 'var(--surface)',
        padding: '6px 16px 8px',
      }}
    >
      {/* prompt_elements — : shell · CWD · git分支 | mode pill */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          minHeight: 22,
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
        {/* AI / cmd 模式 pill — 切换按钮 */}
        <button
          onClick={() => setAiMode(!aiMode)}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            fontWeight: 500,
            padding: '1px 8px',
            border: '1px solid var(--border)',
            borderRadius: 4,
            background: aiMode ? 'var(--accent-warm-dim)' : 'transparent',
            color: aiMode ? 'var(--accent-warm)' : 'var(--text-muted)',
            cursor: 'pointer',
            lineHeight: '16px',
            transition: 'background 0.12s ease, color 0.12s ease',
          }}
        >
          {aiMode ? 'AI' : 'cmd'}
        </button>
      </div>

      {/* input_box — $/⚡ prompt + textarea + 操作按钮（prompt_to_editor_padding ≈ 8px） */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          marginTop: 6,
        }}
      >
        {/* Prompt 字符 — 点击可切换模式 */}
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 13,
            fontWeight: 600,
            minWidth: 16,
            textAlign: 'center',
            color: aiMode ? 'var(--accent-warm)' : 'var(--accent)',
            userSelect: 'none',
            lineHeight: '24px',
            cursor: 'pointer',
          }}
          onClick={() => setAiMode(!aiMode)}
          title={aiMode ? '切回命令模式' : '切换到 AI 模式'}
        >
          {aiMode ? <Zap size={13} /> : '$'}
        </span>

        <textarea
          ref={inputRef}
          value={text}
          placeholder={aiMode ? '自然语言描述你想做什么…' : '输入命令…'}
          rows={1}
          onChange={(e) => {
            setText(e.target.value);
            e.target.style.height = 'auto';
            e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              execute();
            }
            if (e.key === 'Escape') {
              if (text) {
                setText('');
                resetHeight();
              } else if (aiMode) setAiMode(false);
            }
          }}
          style={{
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

        {/* 操作按钮 — subtle hover effect：分裂 + 关闭当前终端 */}
        <InputActionBtn title="选择类型分裂" onClick={() => useUiStore.getState().openSplitPicker()}>
          <Columns2 size={13} />
        </InputActionBtn>
        <InputActionBtn title="关闭当前终端" onClick={() => useWorkspaceStore.getState().closeTerminal(paneId)}>
          <X size={13} />
        </InputActionBtn>
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

function CurrentDir({ dir }: { dir?: string }) {
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
