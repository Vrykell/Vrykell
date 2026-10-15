import { t } from '@i18n';
import { TextArea } from '@ui/TextInput';
import KeyHint from '@ui/KeyHint';
import { IconButton } from '@ui/IconButton';
import { TextButton } from '@ui/TextButton';
/** Pane-scoped composer with separate input and context-chip rows. */

import { iconSizes,
  ArrowDown, DollarSign, Columns2, GitBranch, X, Sparkles,
 } from '@ui/icons';
import { useUiStore } from '@features/workspace';
import { useSessionStore } from '@features/workspace';
import { getLongRunningHint } from '@features/terminal/inputVisibility';
import ShellIndicator from '@features/terminal/components/ShellIndicator';
import { useInputEditorController } from '@features/terminal/hooks/useInputEditorController';
import { TERMINAL_FONT_FAMILY } from '@features/terminal/model/terminalFont';
import { normalizeWorkingDirectory } from '@features/terminal/services/pipeline/workingDirectory';
import DirectoryPicker from './DirectoryPicker';
import CommandSyntax from './CommandSyntax';
import CompletionControl from './CompletionControl';
import { useTypographyStore } from '@config/typography';
import { useRef, type ReactNode } from 'react';


interface Props {
  /** 该输入栏绑定的 pane（决定读写哪个终端） */
  paneId: string;
  /** 该 pane 是否为当前聚焦终端（未传时回退到 focusedPaneId 判定） */
  focused?: boolean;
  isLongRunning?: boolean;
  runningCommand?: string;
  onEndPress?: () => void;
  forceHidden?: boolean;
  onSessionStatusClick?: () => void;
  onSessionStatusReady?: (trigger: HTMLButtonElement | null) => void;
  sessionNotice?: ReactNode;
  sessionStatusOpen?: boolean;
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
  onSessionStatusClick,
  onSessionStatusReady,
  sessionNotice,
  sessionStatusOpen,
  insetLeft = 8,
  insetRight = 8,
}: Props) {
  const {
    inputRef,
    text,
    askAi,
    isFocused,
    hasSession,
    tabCwd,
    terminalLabel,
    recentGitBranch,
    visible,
    panelRef,
    ghost,
    handleChange,
    handleKeyDown,
  } = useInputEditorController({ paneId, focused, isLongRunning, onEndPress });
  const commandHighlighting = useTypographyStore(state => state.commandHighlighting);
  const highlightInput = commandHighlighting && !!text;
  const overlayRef = useRef<HTMLDivElement>(null);

  if (forceHidden) return null;

  if (!visible) {
    const hint = getLongRunningHint(runningCommand || '');
    return (
      <>
      {sessionNotice}
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
        {onSessionStatusClick && <TextButton ref={onSessionStatusReady} className="terminal-chip" aria-expanded={sessionStatusOpen ?? false} data-testid="ssh-status-toggle" aria-label={t('SSH status')} data-tip={t(sessionStatusOpen ? 'Close SSH status' : 'Open SSH status')} onClick={onSessionStatusClick}><ShellIndicator compact connected={hasSession} focused={isFocused} label={terminalLabel} /></TextButton>}
        <span style={{ flex: 1 }}>{hint}</span>
        <IconButton compact data-subtle onClick={onEndPress} data-tip={t('Jump to latest output')}
          data-tip-shortcut="End" aria-label={t('Jump to latest output')}>
          <ArrowDown size={iconSizes.compact} />
        </IconButton>
      </div>
      </>
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
      {sessionNotice}
      <div
        className="terminal-composer"
        style={{ padding: '10px 12px 8px' }}
      >
        <div className="terminal-composer-heading">
          <span>{t('Command input')}</span>
          <span className="composer-key-hints"><KeyHint shortcut="Enter" />{t('Run')}<KeyHint shortcut="Shift+Enter" />{t('New line')}</span>
        </div>

        {/* 输入行 — $/⚡ prompt + textarea + ghost overlay */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <span className="terminal-command-prompt" aria-hidden="true"><DollarSign size={iconSizes.control} /></span>

          {/* textarea + ghost overlay（绝对定位同字体同内边距，透明已输入 + muted 建议后缀）
              display:flex 让 textarea 成为 flex item，消除 inline-block 基线下方空隙（否则容器比 textarea 高 7px） */}
          <div style={{ position: 'relative', flex: 1, minWidth: 0, display: 'flex' }}>
            <TextArea
              ref={inputRef}
              data-terminal-input
              value={text}
              placeholder={t('Enter a command…')}
              rows={1}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              onScroll={event => { if (overlayRef.current) overlayRef.current.scrollTop = event.currentTarget.scrollTop; }}
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
                fontWeight: 'var(--terminal-font-weight)',
                color: highlightInput ? 'transparent' : 'var(--text-primary)',
                lineHeight: 'var(--terminal-input-row-height)',
                outline: 'none',
              }}
            />
            {(ghost || highlightInput) && (
              <div
                ref={overlayRef}
                className="command-input-overlay"
                style={{
                  position: 'absolute',
                  inset: 0,
                  zIndex: 2,
                  pointerEvents: 'none',
                  padding: '1px 0',
                  fontSize: 'var(--terminal-font-size)',
                  fontFamily: TERMINAL_FONT_FAMILY,
                  fontWeight: 'var(--terminal-font-weight)',
                  lineHeight: 'var(--terminal-input-row-height)',
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'break-word',
                  overflow: 'hidden',
                }}
              >
                <span aria-hidden style={{ color: highlightInput ? 'var(--text-primary)' : 'transparent' }}>{highlightInput ? <CommandSyntax text={text} /> : text}</span>
                <span aria-hidden className="command-completion-suffix">{ghost}</span>
                {ghost && <span className="command-completion-action"
                  onClick={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()}>
                  <CompletionControl onReturnFocus={() => inputRef.current?.focus()} />
                </span>}
              </div>
            )}
          </div>


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
          {onSessionStatusClick ? <TextButton ref={onSessionStatusReady} className="terminal-chip" aria-expanded={sessionStatusOpen ?? false} data-testid="ssh-status-toggle" aria-label={t('SSH status')} data-tip={t(sessionStatusOpen ? 'Close SSH status' : 'Open SSH status')} onClick={onSessionStatusClick}><ShellIndicator compact connected={hasSession} focused={isFocused} label={terminalLabel} /></TextButton> : <ShellIndicator connected={hasSession} focused={isFocused} label={terminalLabel} />}
          <DirectoryPicker paneId={paneId} dir={tabCwd} />
          {recentGitBranch && (
            <GitBranchLabel branch={recentGitBranch} />
          )}
          <div style={{ flex: 1, minWidth: 0 }} />
          <TextButton className="terminal-ask-ai" aria-label={t('Ask AI')} data-tip={t('Ask AI')} onClick={askAi}>
            <Sparkles size={iconSizes.control} /><span>{t('Ask AI')}</span>
          </TextButton>
          <InputActionBtn title={t('Choose split type')} onClick={() => useUiStore.getState().openSplitPicker()}>
            <Columns2 size={iconSizes.control} />
          </InputActionBtn>
          <InputActionBtn title={t('Close terminal')} onClick={() => useSessionStore.getState().closeTerminal(paneId)}>
            <X size={iconSizes.control} />
          </InputActionBtn>
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
    <span className="terminal-chip terminal-directory" data-tip={path}>
      {label}
    </span>
  );
}

// ── Git 分支标签 ──

function GitBranchLabel({ branch }: { branch: string }) {
  const label = branch.length > 22 ? branch.slice(0, 21) + '…' : branch;
  return (
    <span
      className="terminal-chip terminal-branch"
      data-tip={branch}
      style={{ color: 'var(--text-primary)' }}
    >
      <GitBranch size={10} style={{ opacity: 0.6, color: 'var(--xterm-blue)' }} />
      {label}
    </span>
  );
}
