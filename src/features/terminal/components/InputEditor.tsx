import { t } from '@i18n';
import { TextArea } from '@ui/TextInput';
import KeyHint from '@ui/KeyHint';
import { IconButton } from '@ui/IconButton';
import { TextButton } from '@ui/TextButton';
import { PermissionModeButton } from '@features/agent';
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

import { iconSizes,
  ArrowUp, Columns2, GitBranch, Paperclip,
  Square, X, Zap,
 } from '@ui/icons';
import ContextRing from '@features/chat/components/ContextRing';
import { useUiStore } from '@features/workspace';
import { useSessionStore } from '@features/workspace';
import { getLongRunningHint } from '@features/terminal/inputVisibility';
import AttachmentChips from '@features/chat/components/AttachmentChips';
import ShellIndicator from '@features/terminal/components/ShellIndicator';
import { useInputEditorController } from '@features/terminal/hooks/useInputEditorController';
import { TERMINAL_FONT_FAMILY } from '@features/terminal/model/terminalFont';
import { normalizeWorkingDirectory } from '@features/terminal/services/pipeline/workingDirectory';


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
          flexShrink: 0,
          background: 'var(--xterm-bg)',
          borderTop: '1px solid var(--block-divider)',
          padding: `5px ${insetRight + 8}px 5px ${insetLeft + 8}px`,
          fontSize: 'calc(12px * var(--ui-font-scale))',
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
            fontSize: 'calc(10px * var(--ui-font-scale))',
            padding: '1px 6px',
            border: '1px solid var(--border)',
            borderRadius: 3,
            background: 'transparent',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            fontFamily: 'var(--font-mono)',
          }}
        >
          <KeyHint shortcut="End" />
        </span>
      </div>
    );
  }

  // Give the composer a clear boundary without competing with terminal output.

  return (
    <div style={{
      flexShrink: 0,
      margin: 0,
      padding: `10px ${insetRight + 4}px 12px ${insetLeft + 4}px`,
      background: 'var(--xterm-bg)',
    }}>
      <div
        className="terminal-composer"
        style={{
          padding: '10px 12px 8px',
        }}
        onDragOver={(e) => { if (aiMode) e.preventDefault(); }}
        onDrop={(e) => {
          if (!aiMode) return;
          e.preventDefault();
          void addBlobs(Array.from(e.dataTransfer.files));
        }}
      >
        <div className="terminal-composer-heading">
          <span>{aiMode ? t('AI chat') : t('Command input')}</span>
          <span className="composer-key-hints"><KeyHint shortcut="Enter" />{aiMode ? t('Send') : t('Run')}<KeyHint shortcut="Shift+Enter" />{t('New line')}</span>
        </div>

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
          {/* Center the mode toggle against the input; the chat panel locks command mode. */}
          <IconButton data-subtle disabled={chatOpen} onClick={toggleAiMode}
            data-tip={t(chatOpen ? 'Use the chat panel' : aiMode ? 'Switch to command mode' : 'Switch to AI mode')}
            aria-label={t(chatOpen ? 'Use the chat panel' : aiMode ? 'Switch to command mode' : 'Switch to AI mode')}>
            {aiMode ? <Zap size={iconSizes.control} /> : '$'}
          </IconButton>

          {/* textarea + ghost overlay（绝对定位同字体同内边距，透明已输入 + muted 建议后缀）
              display:flex 让 textarea 成为 flex item，消除 inline-block 基线下方空隙（否则容器比 textarea 高 7px） */}
          <div style={{ position: 'relative', flex: 1, minWidth: 0, display: 'flex' }}>
            <TextArea
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
                fontSize: 'var(--terminal-font-size)',
                fontFamily: TERMINAL_FONT_FAMILY,
                color: 'var(--text-primary)',
                lineHeight: 'max(22px, var(--terminal-row-height))',
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
                  fontSize: 'var(--terminal-font-size)',
                  fontFamily: TERMINAL_FONT_FAMILY,
                  lineHeight: 'max(22px, var(--terminal-row-height))',
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
              <IconButton data-subtle tone="accent" data-tip={t('Stop generating')} aria-label={t('Stop generating')} onClick={() => abortStream(activeId)}>
                  <Square size={iconSizes.compact} fill="currentColor" />
                </IconButton>
            ) : (
              <IconButton data-subtle tone="accent" data-tip={t('Send')} data-tip-shortcut="Enter" aria-label={t('Send')} onClick={execute} disabled={!canSendAi}>
                  <ArrowUp size={iconSizes.control} />
                </IconButton>
            )}
            </>
          )}
        </div>

        {/* Keep context separate from the primary input row. */}
        <div
          className="terminal-input-status"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            minHeight: 22,
            marginTop: 4,
            paddingTop: 5,
            fontSize: 'calc(11px * var(--ui-font-scale))',
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
          <TextButton disabled={chatOpen} aria-pressed={aiMode}
            data-tip={t(chatOpen ? 'Use the chat panel' : aiMode ? 'Switch to command mode' : 'Switch to AI mode')}
            onClick={() => setAiMode(!aiMode)}>{aiMode ? 'AI' : t('Command')}</TextButton>
          {!aiMode && (
            <>
              <InputActionBtn title={t('Choose split type')} onClick={() => useUiStore.getState().openSplitPicker()}>
                <Columns2 size={iconSizes.control} />
              </InputActionBtn>
              <InputActionBtn title={t('Close terminal')} onClick={() => useSessionStore.getState().closeTerminal(paneId)}>
                <X size={iconSizes.control} />
              </InputActionBtn>
            </>
          )}
          {aiMode && (
            <>
              <PermissionModeButton mode={permMode} onChange={setPermMode} />
              <IconButton data-subtle data-tip={t('Add attachment')} aria-label={t('Add attachment')} onClick={() => void pickFiles()}>
                <Paperclip size={iconSizes.control} />
              </IconButton>
            </>
          )}
        </div>
      </div>

    </div>
  );
}

/** Composer actions use the shared themed target. */
function InputActionBtn({ title, onClick, children }: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return <IconButton data-subtle data-tip={title} aria-label={title} onClick={onClick}>{children}</IconButton>;
}

// ── 工作目录 ──

/** 当前目录标签（mono 11px）；导出给 PanelChat 的 prompt 行复用，保证两处一致 */
export function CurrentDir({ dir }: { dir?: string }) {
  const path = dir ? normalizeWorkingDirectory(dir) : undefined;
  const label = path
    ? path.startsWith('/') && path.length > 20
      ? '…' + path.slice(-19)
      : path
    : '~/project';
  return (
    <span className="terminal-directory" data-tip={path} style={{ fontFamily: 'var(--font-mono)', fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--text-secondary)' }}>
      {label}
    </span>
  );
}

// ── Git 分支标签 ──

function GitBranchLabel({ branch }: { branch: string }) {
  const label = branch.length > 22 ? branch.slice(0, 21) + '…' : branch;
  return (
    <span
      className="terminal-branch"
      data-tip={branch}
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 'calc(11px * var(--ui-font-scale))',
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
