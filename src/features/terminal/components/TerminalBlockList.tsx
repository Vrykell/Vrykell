import CommandSyntax from './CommandSyntax';
import { IconButton } from '@ui/IconButton';
import { t } from '@i18n';
import CommandStatus from './CommandStatus';
import { applyTerminalRenderer } from '../model/xtermRenderer';
import { useTypographyStore } from '@config/typography';
import { configureTerminalInput } from '@features/terminal/model/terminalInput';
/**
 * TerminalBlockList renders command output as a continuous stream with thin separators.
 * Commands and output share an inset; path and duration remain visible while controls reveal on hover.
 */

import { memo, useState, useEffect, useRef } from 'react';
import { COMMAND_BLOCK_CONTENT_PADDING } from '../model/commandBlockLayout';
import {
  Ellipsis, CircleX, Maximize2, Square, Zap,
} from '@ui/icons';
import { useTerminalStore } from '@features/terminal';
import AiBlock from '@features/chat/components/AiBlock';
import { ptyResize } from '@platform/pty';
import { STATUS_ACTION_ICON_SIZE, StatusActionButton, TerminalStatusBar } from './TerminalStatusBar';
import { TerminalRedrawButton } from './TerminalRedrawButton';
import { getCellMetrics } from '@utils/termMetrics';
import { getExecutingTerm, resizeExecutingTerm, syncTermWidth } from '@features/terminal/hooks/useTerminalSession';
import { isTerminalDebugEnabled, terminalDebug } from '@features/terminal/services/terminalDebug';
import BlockMenu from '@features/terminal/components/BlockMenu';
import BlockOutput from '@features/terminal/components/BlockOutput';
import type { TermBlock } from '@features/terminal/services/pipeline/termBlock';
import { useTerminalBlockFlow } from '@features/terminal/hooks/useTerminalBlockFlow';
import type { BlockMenuAnchor } from '@features/terminal/hooks/useTerminalBlockFlow';
import { useTuiControls } from '@features/terminal/hooks/useTuiControls';
import { hasVisibleContent as hasVisibleBlockContent } from '@features/terminal/model/blockVisibility';
import { copyTerminalSelection, pasteClipboardIntoTerminal } from '@features/terminal/services/terminalClipboard';
import { TERMINAL_FONT_FAMILY } from '@features/terminal/model/terminalFont';
import { measureRunningTerminalRows } from '../model/runningTerminalRows';
import { repaintTerminal } from '../model/terminalResize';
import { useSessionStore } from '@features/workspace';

interface Props {
  tabId: string;
  /** Outer pane insets; command content adds its own consistent spacing. */
  insetLeft?: number;
  insetRight?: number;
}

/** Strip CSI sequences from the clipboard fallback; OSC is removed upstream. */
const ANSI_CSI_RE = /\x1b\[[0-9;?]*[a-zA-Z]/g;

/** Omit unsubmitted shell prompts while keeping explicit empty submissions. */
export function hasVisibleContent(b: TermBlock): boolean {
  return hasVisibleBlockContent(b);
}

export default function TerminalBlockList({ tabId, insetLeft = 8, insetRight = 8 }: Props) {
  const {
    highlightQuery,
    running,
    flow,
    menuBlock,
    openMenu,
    closeMenu,
  } = useTerminalBlockFlow(tabId);

  if (flow.length === 0 && running.length === 0) return null;

  return (
    <>
      {/* Completed commands and inline chat are interleaved by time. */}
      {flow.map((item, index) =>
        item.type === 'block' ? (
          <BlockItem
            key={item.block.id}
            block={item.block}
            tabId={tabId}
            insetLeft={insetLeft}
            insetRight={insetRight}
            highlightQuery={highlightQuery}
            dividerBefore={index > 0}
            onMenu={openMenu}
            menuOpen={menuBlock?.block.id === item.block.id}
          />
        ) : (
          <AiBlock key={item.exchange.id} exchange={item.exchange} dividerBefore={index > 0}
            style={{ paddingLeft: insetLeft + COMMAND_BLOCK_CONTENT_PADDING, paddingRight: insetRight + COMMAND_BLOCK_CONTENT_PADDING }} />
        ),
      )}

      {/* Running commands retain their live terminal. */}
      {running.map((b) => (
        <RunningItem
          key={b.id}
          block={b}
          tabId={tabId}
          insetLeft={insetLeft}
          insetRight={insetRight}
          highlightQuery={highlightQuery}
          dividerBefore={flow.length > 0}
        />
      ))}

      {/* Both pointer and control anchors open the same menu. */}
      {menuBlock && (
        <BlockMenu
          block={menuBlock.block}
          paneId={tabId}
          anchor={menuBlock.anchor}
          onClose={closeMenu}
          getOutputText={() =>
            menuBlock.block.outputText ||
            menuBlock.block.outputRaw.replace(ANSI_CSI_RE, '')
          }
        />
      )}
    </>
  );
}

// Search highlighting.

function highlightFragments(
  text: string,
  query: string,
): Array<{ text: string; hl: boolean }> {
  if (!query || query.length < 2 || !text) return [{ text, hl: false }];
  const lower = text.toLowerCase();
  const ql = query.toLowerCase();
  const parts: Array<{ text: string; hl: boolean }> = [];
  let pos = 0;
  while (pos < text.length) {
    const idx = lower.indexOf(ql, pos);
    if (idx === -1) {
      parts.push({ text: text.slice(pos), hl: false });
      break;
    }
    if (idx > pos) parts.push({ text: text.slice(pos, idx), hl: false });
    parts.push({ text: text.slice(idx, idx + ql.length), hl: true });
    pos = idx + ql.length;
  }
  return parts;
}

function HighlightSpan({ text, query }: { text: string; query: string }) {
  const frags = highlightFragments(text, query);
  if (frags.length === 1 && !frags[0]!.hl) return <>{text}</>;
  return (
    <>
      {frags.map((f, i) =>
        f.hl ? (
          <mark
            key={i}
            style={{
              background: 'var(--search-highlight-bg)',
              color: 'inherit',
              borderRadius: 2,
              padding: '0 1px',
            }}
          >
            {f.text}
          </mark>
        ) : (
          <span key={i}>{f.text}</span>
        ),
      )}
    </>
  );
}

// Completed command blocks.

const BlockItem = memo(function BlockItem({
  block, tabId, insetLeft, insetRight, highlightQuery, dividerBefore, onMenu, menuOpen,
}: {
  block: TermBlock;
  tabId: string;
  insetLeft: number;
  insetRight: number;
  highlightQuery: string;
  dividerBefore: boolean;
  onMenu: (b: TermBlock, anchor: BlockMenuAnchor) => void;
  menuOpen: boolean;
}) {
  const duration = block.endedAt !== null && block.startedAt !== null
    ? block.endedAt - block.startedAt : null;
  const highlightCommands = useTypographyStore(state => state.commandHighlighting);
  const coloredCommand = highlightCommands ? <CommandSyntax text={block.command} /> : block.command;

  return (
    <div
      className="command-block"
      data-testid={`command-block-${block.id}`}
      data-command-block-id={block.id}
      data-menu-open={menuOpen}
      data-failed={block.exitCode !== null && block.exitCode !== 0}
      data-divider-before={dividerBefore}
      data-pane-id={tabId}
      style={{
        paddingLeft: insetLeft + COMMAND_BLOCK_CONTENT_PADDING,
        paddingRight: insetRight + COMMAND_BLOCK_CONTENT_PADDING,
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onMenu(block, { kind: 'pointer', x: event.clientX, y: event.clientY });
      }}
    >
      <div data-selectable className="command-block-info">
        <BlockContext block={block} />
        <CommandStatus exitCode={block.exitCode} duration={duration} agent={block.agent} />
        {block.gitBranch && <span className="command-block-branch">{block.gitBranch}</span>}
        <span className="command-block-actions">
          <IconButton compact data-subtle data-tip={t('More actions')} aria-label={t('More actions')}
            aria-haspopup="menu" aria-expanded={menuOpen}
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              onMenu(block, { kind: 'control', left: rect.left, top: rect.bottom + 4 });
            }}>
            <Ellipsis size={STATUS_ACTION_ICON_SIZE} />
          </IconButton>
        </span>
      </div>
      <div data-selectable className="command-block-command" style={{ fontFamily: TERMINAL_FONT_FAMILY }}>
        {highlightQuery ? <HighlightSpan text={block.command} query={highlightQuery} /> : coloredCommand}
      </div>
      {(block.outputHtml || block.outputText) && <div className="command-block-output">
        <BlockOutput text={block.outputHtml || block.outputText} isHtml={!!block.outputHtml}
          flush highlight={highlightQuery || undefined} />
      </div>}
      {block.linesTruncated > 0 && <div data-selectable className="command-block-info command-block-truncation">
        {t('Truncated {{count}} lines', { count: block.linesTruncated })}
      </div>}
    </div>
  );
});

/** Context stays on its own row so commands and output share the full content width. */
function BlockContext({ block }: { block: TermBlock }) {
  return <>
    {block.cwd && <span className="command-block-cwd" data-tip={block.cwd}>{block.cwd}</span>}
  </>;
}

// Running command blocks.

function RunningItem({
  block,
  tabId,
  insetLeft,
  insetRight,
  highlightQuery,
  dividerBefore,
}: {
  block: TermBlock;
  tabId: string;
  insetLeft: number;
  insetRight: number;
  highlightQuery: string;
  dividerBefore: boolean;
}) {
  const { sendCtrlC, killApp, killArmed, enterFullScreen } = useTuiControls(tabId);

  const [outputReady, setOutputReady] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setOutputReady(true), 120);
    return () => clearTimeout(timer);
  }, []);

  const highlightCommands = useTypographyStore(state => state.commandHighlighting);
  const coloredCommand = highlightCommands ? <CommandSyntax text={block.command || ''} /> : block.command;

  // Short commands publish their completed output atomically instead of inserting
  // and immediately replacing a temporary header that moves the whole history.
  if (!outputReady) return null;

  return (
    <div
      data-testid={`running-block-${block.id}`}
      data-command-block-id={block.id}
      data-running="true"
      data-divider-before={dividerBefore}
      className="command-block"
      style={{
        paddingLeft: insetLeft + COMMAND_BLOCK_CONTENT_PADDING,
        paddingRight: insetRight + COMMAND_BLOCK_CONTENT_PADDING,
      }}
    >
      <TerminalStatusBar
        cwd={block.cwd}
        startedAt={block.startedAt}
        gitBranch={block.gitBranch}
        agent={block.agent ? <Zap size={14} className="command-status-agent" aria-label={t('AI execution')} /> : undefined}
        actions={<>
          <TerminalRedrawButton paneId={tabId} />
          <StatusActionButton title={t('Interrupt command')} shortcut="Control+C" onClick={sendCtrlC} label={<Square size={STATUS_ACTION_ICON_SIZE} />} />
          <StatusActionButton title={killArmed ? t('Force quit foreground process') : t('Quit foreground process')} onClick={killApp} label={<CircleX size={STATUS_ACTION_ICON_SIZE} />} />
          <StatusActionButton title={t('Enter fullscreen interaction')} onClick={enterFullScreen} label={<Maximize2 size={STATUS_ACTION_ICON_SIZE} />} />
        </>}
      />
      <div data-selectable className="command-block-command" style={{ fontFamily: TERMINAL_FONT_FAMILY }}>
        {highlightQuery ? <HighlightSpan text={block.command} query={highlightQuery} /> : coloredCommand}
      </div>

      {/* Live xterm preserves native cursor, IME, and CJK layout while the command runs. */}
      <RunningTerm tabId={tabId} blockId={block.id} />
    </div>
  );
}

// Live output host.

/**
 * Mount the controller-owned live terminal, trim it to visible output, and connect input.
 * The controller owns the terminal lifecycle; this component only manages subscriptions.
 */
function RunningTerm({ tabId, blockId }: { tabId: string; blockId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const occupiedRowsRef = useRef(1);
  // Move the live terminal into the fullscreen host when manually activated.
  const tuiFs = useTerminalStore(
    (s) => s.altScreenActive && (s.scenes[tabId] ?? 'classic') === 'altScreen',
  );

  useEffect(() => {
    const handle = getExecutingTerm(tabId);
    if (!handle) {
      if (isTerminalDebugEnabled()) {
        terminalDebug('running-terminal-mount-missing', { tabId, blockId });
      }
      return;
    }
    const { term, el } = handle;
    const host = tuiFs
      ? document.querySelector<HTMLElement>('[data-testid="tui-fullscreen"]')
      : hostRef.current;
    if (!host) {
      if (isTerminalDebugEnabled()) {
        terminalDebug('running-terminal-host-missing', { tabId, blockId, fullscreen: tuiFs });
      }
      return;
    }

    let openResyncRaf = 0;
    host.appendChild(el);
    if (!term.element) term.open(el);
    // Output can arrive before the terminal is opened (headless writes). The buffer then
    // follows the tail while the scrollbar model stays at the top, so the first wheel-up
    // jumps to the start of the scrollback instead of scrolling from the bottom. Re-sync
    // the model on the first frame of this mount; the pair is a no-op unless the view is
    // at the bottom and the geometry is measured (open() measures synchronously).
    openResyncRaf = requestAnimationFrame(() => {
      if (term.buffer.active.viewportY === term.buffer.active.baseY) {
        term.scrollToTop();
        term.scrollToBottom();
      }
    });
    applyTerminalRenderer(term, useTypographyStore.getState().terminalRenderer);
    configureTerminalInput(term);
    if (isTerminalDebugEnabled()) {
      terminalDebug('running-terminal-mounted', {
        tabId,
        blockId,
        fullscreen: tuiFs,
        hostWidth: host.clientWidth,
        hostVisible: host.getClientRects().length > 0,
      });
    }
    // e2e 测试桥：块终端 buffer 也进注册表（WebGL 下文本不进 DOM，测试读 buffer 断言）
    const w = window as unknown as { __vrykellTerms?: Map<string, unknown> };
    w.__vrykellTerms?.set(`block:${tabId}`, term);

    // Preserve occupied space across partial clear-and-repaint frames, but let a smaller frame
    // settle: a TUI that clears and rewrites itself into fewer rows (for example after a resize)
    // otherwise keeps the old height as a black tail that the follow position shows on screen.
    // 80 ms covers the split writes of one repaint (output arrives in ~16 ms batches) while a
    // frame that really settled smaller adopts its height almost immediately.
    const cellHeight = (): number => getCellMetrics(term).height;
    // Track the row count the style currently holds: the first crop must land even when the
    // measurement equals the initial one, otherwise the element keeps its uncropped natural height.
    let appliedRows: number | null = null;
    const applyHeight = () => {
      appliedRows = occupiedRowsRef.current;
      // The xterm element has 4px of vertical padding on each side.
      el.style.height = `${occupiedRowsRef.current * cellHeight() + 8}px`;
    };
    let shrinkTimer: ReturnType<typeof setTimeout> | null = null;
    let visibleOutputLogged = false;
    const updateHeight = () => {
      const occupied = measureRunningTerminalRows(term.buffer.active, term.rows, 1);
      if (occupied >= occupiedRowsRef.current) {
        if (shrinkTimer) { clearTimeout(shrinkTimer); shrinkTimer = null; }
        occupiedRowsRef.current = occupied;
        if (appliedRows !== occupied) applyHeight();
      } else if (!shrinkTimer) {
        shrinkTimer = setTimeout(() => {
          shrinkTimer = null;
          const settled = measureRunningTerminalRows(term.buffer.active, term.rows, 1);
          if (settled < occupiedRowsRef.current) {
            occupiedRowsRef.current = settled;
            applyHeight();
            if (isTerminalDebugEnabled()) {
              terminalDebug('running-terminal-height-settled', { tabId, blockId, rows: settled });
            }
          }
        }, 80);
      }
      if (!visibleOutputLogged && occupiedRowsRef.current > 1 && isTerminalDebugEnabled()) {
        visibleOutputLogged = true;
        terminalDebug('running-terminal-output-visible', { tabId, blockId, rows: occupiedRowsRef.current });
      }
    };

    let renderSub: { dispose(): void } | null = null;
    const resizeFullscreen = () => {
      const screen = el.querySelector<HTMLElement>('.xterm-screen');
      if (!screen || term.cols <= 0 || term.rows <= 0) return;
      const rect = screen.getBoundingClientRect();
      const cellW = rect.width / term.cols;
      const cellH = rect.height / term.rows;
      if (cellW <= 0 || cellH <= 0) return;
      const cols = Math.max(2, Math.floor(host.clientWidth / cellW));
      const rows = Math.max(1, Math.floor(host.clientHeight / cellH));
      if (cols === term.cols && rows === term.rows) return;
      resizeExecutingTerm(tabId, cols, rows);
      const sid = useTerminalStore.getState().sessions[tabId];
      if (sid) ptyResize(sid, cols, rows).catch(() => {});
    };
    if (tuiFs) {
      el.style.height = '100%'; // 全屏：不裁剪，完整行数可见
      term.focus(); // 主 xterm 已隐藏，键盘落点交给块终端
      requestAnimationFrame(resizeFullscreen);
    } else {
      updateHeight();
      renderSub = term.onRender(updateHeight);
    }

    // The controller owns data forwarding for both replies and native keyboard input.
    // 复制/粘贴归终端（End 保留给「回到输入栏」，不进 PTY）：Ctrl+C 有选区时复制、
    // Ctrl+V 粘贴，Ctrl+Shift+C/V 同样有效。
    term.attachCustomKeyEventHandler((e) => {
      if (e.type === 'keydown' && (e.ctrlKey || e.metaKey) && !e.altKey) {
        const key = e.key.toLowerCase();
        const copy = key === 'c' && (e.metaKey || e.shiftKey || term.hasSelection());
        const paste = key === 'v';
        if (copy || paste) {
          e.preventDefault();
          if (copy) void copyTerminalSelection(term);
          else void pasteClipboardIntoTerminal(tabId);
          return false;
        }
      }
      return !(e.type === 'keydown' && e.key === 'End');
    });
    let wheelResidual = 0;
    term.attachCustomWheelEventHandler((event) => {
      if (term.modes.mouseTrackingMode !== 'none' || term.buffer.active.type === 'alternate') {
        wheelResidual = 0;
        return true;
      }
      const lineHeight = Math.max(1, getCellMetrics(term).height);
      const delta = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * lineHeight
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? event.deltaY * lineHeight * term.rows : event.deltaY;
      if (Math.sign(delta) !== Math.sign(wheelResidual)) wheelResidual = 0;
      wheelResidual += delta;
      const lines = Math.trunc(wheelResidual / lineHeight);
      if (lines === 0) {
        event.preventDefault();
        return false;
      }
      wheelResidual -= lines * lineHeight;
      term.scrollLines(lines);
      event.preventDefault();
      return false;
    });
    // Recheck terminal columns when the host width changes, including its first layout.
    let lastHostWidth = -1;
    const widthRo = new ResizeObserver(() => {
      if (tuiFs) resizeFullscreen();
      else if (host.clientWidth > 0 && host.clientWidth !== lastHostWidth) {
        lastHostWidth = host.clientWidth;
        syncTermWidth(tabId);
      }
    });
    widthRo.observe(host);

    // The block is hidden with its tab or the page is backgrounded; a static TUI prints
    // nothing to trigger a repaint, so restore the surface when it becomes visible again.
    const restoreSurface = () => {
      if (el.clientWidth === 0 || el.clientHeight === 0) return;
      applyTerminalRenderer(term, useTypographyStore.getState().terminalRenderer);
      repaintTerminal(term);
      if (isTerminalDebugEnabled()) {
        terminalDebug('running-terminal-visibility-repaint', { tabId, blockId, cols: term.cols, rows: term.rows });
      }
    };
    let restoreRaf = requestAnimationFrame(restoreSurface);
    const unsubscribeActiveTab = useSessionStore.subscribe((state, previous) => {
      if (state.activeId === previous.activeId) return;
      cancelAnimationFrame(restoreRaf);
      restoreRaf = requestAnimationFrame(restoreSurface);
    });
    let termWasHidden = false;
    const visibilityRo = new ResizeObserver(() => {
      if (el.clientWidth === 0 || el.clientHeight === 0) {
        termWasHidden = true;
        return;
      }
      if (!termWasHidden) return;
      termWasHidden = false;
      restoreSurface();
    });
    visibilityRo.observe(el);
    const onVisibilityChange = () => { if (!document.hidden) restoreSurface(); };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      if (w.__vrykellTerms?.get(`block:${tabId}`) === term) {
        w.__vrykellTerms.delete(`block:${tabId}`);
      }
      renderSub?.dispose();
      if (shrinkTimer) { clearTimeout(shrinkTimer); shrinkTimer = null; }
      unsubscribeActiveTab();
      cancelAnimationFrame(restoreRaf);
      cancelAnimationFrame(openResyncRaf);
      widthRo.disconnect();
      visibilityRo.disconnect();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [tabId, blockId, tuiFs]);

  return (
    <div
      ref={hostRef}
      data-testid="running-term"
      className="command-block-output"
      style={{ overflow: 'hidden' }}
    />
  );
}
