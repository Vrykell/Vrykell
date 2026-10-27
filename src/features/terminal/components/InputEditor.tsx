import { t } from '@i18n';
import { TextArea } from '@ui/fields/TextInput';
import KeyHint from '@ui/feedback/KeyHint';
import { IconButton } from '@ui/actions/IconButton';
import { TextButton } from '@ui/actions/TextButton';
/** Pane-scoped composer with separate input and context-chip rows. */

import { iconSizes,
  ArrowDown, DollarSign, Columns2, X, Sparkles,
 } from '@ui/icons';
import { useUiStore } from '@features/workspace';
import { useCanRemoveWorkspacePane, useWorkspaceNavigation } from '@features/workspace';
import { closeTerminalPane } from '@features/workspace/services/unifiedWorkspace';
import { getLongRunningHint } from '@features/terminal/inputVisibility';
import ShellIndicator from '@features/terminal/components/ShellIndicator';
import { useInputEditorController } from '@features/terminal/hooks/useInputEditorController';
import { TERMINAL_FONT_FAMILY } from '@features/terminal/model/terminalFont';
import { normalizeWorkingDirectory } from '@features/terminal/services/pipeline/workingDirectory';
import { terminalDebug } from '@features/terminal/services/terminalDebug';
import DirectoryPicker from './DirectoryPicker';
import CommandSyntax from './CommandSyntax';
import CompletionControl from './CompletionControl';
import { GitStatusButton } from '@features/git';
import { useTypographyStore } from '@config/typography';
import { useRef, useLayoutEffect, useCallback, type ReactNode } from 'react';


interface Props {
  /** Pane this composer is bound to (decides which terminal it reads and writes) */
  paneId: string;
  /** Whether this pane is focused (falls back to focusedPaneId when omitted) */
  focused?: boolean;
  isLongRunning?: boolean;
  runningCommand?: string;
  onEndPress?: () => void;
  forceHidden?: boolean;
  onSessionStatusClick?: () => void;
  onSessionStatusReady?: (trigger: HTMLButtonElement | null) => void;
  sessionNotice?: ReactNode;
  sessionStatusOpen?: boolean;
  /** Horizontal insets, matched to command blocks (4 inside, 8 outside) */
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
  const unified = useWorkspaceNavigation(state => state.area === 'unified');
  const canRemovePane = useCanRemoveWorkspacePane();
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

  // The mirror only hears about scroll events while the textarea's own offset moves. Content can
  // grow past the capped height without moving it (the caret line is already on screen), so the
  // freshly typed line would stay below the mirror's parked position and never paint. Re-run the
  // sync after every content change to keep the visible text on top of the real input.
  useLayoutEffect(() => {
    const element = inputRef.current;
    const overlay = overlayRef.current;
    if (!element || !overlay) return;
    overlay.scrollTop = element.scrollTop;
    // Geometry and lengths only: the mirror must keep both the text and the box of the real input.
    terminalDebug('composer-mirror-sync', {
      paneId,
      chars: text.length,
      mirrorChars: overlay.firstElementChild?.textContent?.length ?? -1,
      inputScroll: element.scrollTop,
      mirrorScroll: overlay.scrollTop,
      inputHeight: element.scrollHeight,
      mirrorHeight: overlay.scrollHeight,
      inputWidth: element.clientWidth,
      mirrorWidth: overlay.clientWidth,
    });
  }, [paneId, text, ghost, highlightInput]);

  // Focus routing decides whether typing reaches the composer at all; record the destination
  // without any key or text payload.
  const logComposerFocus = useCallback((focused: boolean) => {
    const record = () => {
      const active = document.activeElement as HTMLElement | null;
      terminalDebug('composer-focus', {
        paneId, focused, target: active?.tagName ?? null,
        terminal: !!active && (active.hasAttribute('data-terminal-input') || !!active.closest('.xterm')),
      });
    };
    if (focused) record(); else setTimeout(record, 0);
  }, [paneId]);

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

        {/* Input row — prompt, textarea and ghost overlay */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <span className="terminal-command-prompt" aria-hidden="true"><DollarSign size={iconSizes.control} /></span>

          {/* Textarea plus ghost overlay: absolutely positioned with the same font and padding,
              transparent typed text and a muted suggestion suffix. display:flex makes the textarea
              a flex item, removing the inline-block baseline gap that makes the container 7px taller. */}
          <div style={{ position: 'relative', flex: 1, minWidth: 0, display: 'flex' }}>
            <TextArea
              ref={inputRef}
              data-terminal-input
              className={highlightInput ? 'command-input-highlighted' : undefined}
              value={text}
              placeholder={t('Enter a command…')}
              rows={1}
              onChange={handleChange}
              onFocus={() => logComposerFocus(true)}
              onBlur={() => logComposerFocus(false)}
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
                {/* The textarea reserves a line for the caret after a trailing newline, while
                    `pre-wrap` drops that line box; a zero-width space restores it so both
                    layers keep the same scroll height and the mirror can track exactly. */}
                <span aria-hidden style={{ color: highlightInput ? 'var(--text-primary)' : 'transparent' }}>{highlightInput ? <CommandSyntax text={text} /> : text}{text.endsWith('\n') ? '\u200b' : null}</span>
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
            <GitStatusButton branch={recentGitBranch} paneId={paneId} />
          )}
          <div style={{ flex: 1, minWidth: 0 }} />
          <TextButton className="terminal-ask-ai" aria-label={t('Ask AI')} data-tip={t('Ask AI')} onClick={askAi}>
            <Sparkles size={iconSizes.control} /><span>{t('Ask AI')}</span>
          </TextButton>
          <InputActionBtn title={t('Choose split type')} onClick={() => useUiStore.getState().openSplitPicker()}>
            <Columns2 size={iconSizes.control} />
          </InputActionBtn>
          {(!unified || canRemovePane) && <InputActionBtn title={t(unified ? 'Remove pane' : 'Close terminal')} onClick={() => closeTerminalPane(paneId)}>
            <X size={iconSizes.control} />
          </InputActionBtn>}
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

// ── Working directory ──

/** Current directory chip (mono 11px), exported so the chat prompt row can reuse it and stay consistent */
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
