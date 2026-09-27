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

import {
  ArrowUp, Columns2, GitBranch, Paperclip,
  ShieldAlert, ShieldCheck, ShieldOff, Square, X, Zap,
} from 'lucide-react';
import ContextRing from '@features/chat/components/ContextRing';
import { useUiStore } from '@features/workspace';
import { useSessionStore } from '@features/workspace';
import { getLongRunningHint } from '@features/terminal/inputVisibility';
import AttachmentChips from '@features/chat/components/AttachmentChips';
import ShellIndicator from '@features/terminal/components/ShellIndicator';
import { useInputEditorController } from '@features/terminal/hooks/useInputEditorController';
import { TERMINAL_FONT_FAMILY, TERMINAL_FONT_SIZE } from '@features/terminal/model/terminalFont';

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
  const {
    inputRef,
    text,
    aiMode,
    setAiMode,
    toggleAiMode,
    isFocused,
    hasSession,
    tabCwd,
    terminalLabel,
    recentGitBranch,
    visible,
    chatOpen,
    sendingHere,
    activeId,
    abortStream,
    permMode,
    setPermMode,
    atts,
    previewId,
    panelRef,
    pickFiles,
    addBlobs,
    togglePreview,
    removeAttachment,
    canSendAi,
    ghost,
    execute,
    handleChange,
    handlePaste,
    handleKeyDown,
  } = useInputEditorController({ paneId, focused, isLongRunning, onEndPress });


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
              fontFamily: TERMINAL_FONT_FAMILY,
              fontSize: TERMINAL_FONT_SIZE,
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
            onClick={toggleAiMode}
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
              onChange={handleChange}
              onPaste={handlePaste}
              onKeyDown={handleKeyDown}
              style={{
                position: 'relative',
                zIndex: 1,
                flex: 1,
                minWidth: 0,
                resize: 'none',
                background: 'transparent',
                border: 'none',
                padding: '1px 0',
                fontSize: TERMINAL_FONT_SIZE,
                fontFamily: TERMINAL_FONT_FAMILY,
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
                  fontSize: TERMINAL_FONT_SIZE,
                  fontFamily: TERMINAL_FONT_FAMILY,
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
