import { preferredShell } from '@config/terminalDefaults';
import { useShellProfiles } from '@config/shellProfiles';
import { getAvailableShells, type ShellType } from '@platform/shells';
import { createResizeQueue, fitTerminal, repaintTerminal } from '../model/terminalResize';
import { configureTerminalInput } from '@features/terminal/model/terminalInput';
/**
 * useTerminalSession — 主 xterm 生命周期 + SessionController 接线。
 *
 * 主 xterm 只在 classic / altScreen 场景接收数据（blockList 下闲置隐藏）。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { captureConnectionFrame, type TerminalFrame } from '../model/terminalFrame';
import { projectBlocks } from '../model/blockProjection';
import { COMMAND_BLOCK_CONTENT_PADDING } from '../model/commandBlockLayout';
import { Terminal } from '@xterm/xterm';
import { applyTerminalRenderer, hasWebglRenderer, loadWebglRenderer, releaseTerminalRenderer } from '@features/terminal/model/xtermRenderer';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { ptySpawn, ptyWrite, ptyResize, ptyClose, onPtyOutput, onPtyExit, type PtySpawnOptions } from '@platform/pty';
import { registerTerminal, unregisterTerminal, useTerminalStore } from '@features/terminal';
import { getRecentOutputFor } from '@features/terminal/stores/terminal';
import { useBlockStore } from '@features/terminal';
import { useHistoryStore } from '@features/terminal/stores/history';
import { captureHistoryCommand } from '@features/command-history/services/recording';
import { isTerminalDebugEnabled, terminalDebug } from '@features/terminal/services/terminalDebug';
import { readXtermTheme } from '@features/terminal/model/xtermTheme';
import { useSessionStore, useUiStore, useWorkspaceNavigation } from '@features/workspace';
import { leaves as layoutLeaves } from '@features/workspace/model/windowLayout';
import * as sessionManager from '@features/workspace/services/sessionManager';
import { agentControl } from '@features/agent/services/agentControl';
import { defaultOpenModeForShell } from '@features/agent/stores/agentSettings';
import { t } from '@i18n';
import { SessionController } from '@features/terminal/services/pipeline/sessionController';
import { blockTerminalFor, recoverTerminalSurfaces } from '@features/terminal/services/terminalRepaint';
import { captureTerminalPaste, copyTerminalSelection, pasteClipboardIntoTerminal } from '@features/terminal/services/terminalClipboard';
import { cancelTerminalInput, writeTerminalInput } from '@features/terminal/services/terminalWriteQueue';
import { setPendingCommandRegistrar } from '@features/terminal/services/pendingCommandRegistry';
import { querySequences } from '@features/terminal/model/terminalQueries';
import { getCellMetrics } from '@utils/termMetrics';
import type { DispatchEvent } from '@core/terminal/events';
import type { SshLogEntry } from '@core/ssh';
import { appendLogEntry, connectionLogLines, isSshClientNotice } from '../model/connectionLog';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { getTerminalFontOptions, measureTerminalDomCellWidth } from '@features/terminal/model/terminalFont';
import { applyTerminalCursorPreference } from '@features/terminal/model/terminalCursor';
import { prepareSshHost } from '@features/ssh/services/hostTrust';
import { startAutomaticForwarding } from '@features/ssh';
import { useToastStore } from '@ui/feedback/Toast';
import { terminalTypographyChanged, useTypographyStore } from '@config/typography';
import { isLayoutResizeDragActive, onLayoutResizeDragEnd } from '@ui/layout/layoutResizeDrag';

/** Live session references shared across development reloads. */
interface SessionRegistry {
  controllers: Map<string, SessionController>;
  pendingUiCommands: Map<string, { command: string; wireCommand?: string; stagedAt: number }>;
  widthSyncs: Map<string, () => void>;
}

// Preserve live controller references when the renderer reloads a module during development.
const registryScope = globalThis as typeof globalThis & { __vrykellSessionRegistry?: SessionRegistry };
const sessionRegistry = registryScope.__vrykellSessionRegistry ??= {
  controllers: new Map<string, SessionController>(),
  pendingUiCommands: new Map<string, { command: string; wireCommand?: string; stagedAt: number }>(),
  widthSyncs: new Map<string, () => void>(),
};
const sessionControllers = sessionRegistry.controllers;
const pendingUiCommands = sessionRegistry.pendingUiCommands;
const widthSyncs = sessionRegistry.widthSyncs;
const PENDING_COMMAND_TTL_MS = 30_000;

/** A write whose parse callback is delayed this long reports the backlog it sat behind. */
const TERMINAL_PARSE_LAG_REPORT_MS = 250;

/** Bound the startup buffer so a stale session flooding output cannot grow it forever. */
const PRE_SESSION_MAX_BATCHES = 512;

/** 清除指定 tab 的全部输出块；无存活 session 时退化为清 store。 */
export function clearSessionBlocks(tabId: string): void {
  const c = sessionControllers.get(tabId);
  if (c) c.clear();
  else useBlockStore.getState().clearBlocks(tabId);
}

export function setPendingTerminalCommand(tabId: string, command: string, wireCommand?: string): boolean {
  const normalized = command.trim();
  if (!normalized) return false;
  const controller = sessionControllers.get(tabId);
  if (!controller) {
    pendingUiCommands.set(tabId, { command: normalized, wireCommand, stagedAt: Date.now() });
    if (isTerminalDebugEnabled()) {
      terminalDebug('command-pending-deferred', { paneId: tabId, chars: normalized.length, wireChars: wireCommand?.length ?? 0 });
    }
    return true;
  }
  const accepted = controller.setPendingCommand(normalized, wireCommand);
  if (accepted) pendingUiCommands.set(tabId, { command: normalized, wireCommand, stagedAt: Date.now() });
  else pendingUiCommands.delete(tabId);
  return accepted;
}

/** Drop a submission whose PTY write failed before the shell could report it. */
export function clearPendingTerminalCommand(tabId: string): void {
  pendingUiCommands.delete(tabId);
  sessionControllers.get(tabId)?.clearPendingCommand();
}

/** Empty submissions retain their visual spacing while the PTY handles the actual input. */
export function appendTerminalBlankLines(paneId: string, count: number): void {
  sessionControllers.get(paneId)?.appendBlankLines(count);
}

/** 运行中块的活终端（RunningItem 挂载显示 / useTerminalFocus 聚焦目标） */
export function getExecutingTerm(tabId: string) {
  return sessionControllers.get(tabId)?.executingTerm ?? null;
}

/** Scene-aware resize driver; block output follows the available command-list width. */

/** 触发指定 tab 重新校核 PTY/块终端宽度（无 session 时 no-op） */
export function syncTermWidth(tabId: string): void {
  widthSyncs.get(tabId)?.();
}

/** Estimate command content width before the visible output host mounts. */
const BLOCK_CONTENT_INSET_PX = 16 + 2 * COMMAND_BLOCK_CONTENT_PADDING;

/** Output silence that marks a prompt for shells without the ready marker. */
const SHELL_IDLE_READY_MS = 2500;

/** Automatic reconnect after an unexpected drop: bounded attempts with exponential backoff. */
const SSH_RECONNECT_MAX_ATTEMPTS = 5;
const SSH_RECONNECT_BASE_MS = 1000;
const SSH_RECONNECT_MAX_MS = 16000;

export function useTerminalSession(
  paneId: string,
  tabId: string,
  onReady: (sessionId: string) => void,
  onConnectionOutput?: (text: string) => void,
) {
  const ownerTab = useRef(tabId);
  ownerTab.current = tabId;
  const containerRef = useRef<HTMLDivElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<'connecting' | 'ready' | 'closed' | 'error'>('connecting');
  const [sshAuthenticated, setSshAuthenticated] = useState(false);
  const [sshLog, setSshLog] = useState<SshLogEntry[]>([]);
  const [frame, setFrame] = useState<TerminalFrame | null>(null);
  const closeSessionRef = useRef<() => Promise<void>>(async () => {});
  const closeSession = useCallback(() => closeSessionRef.current(), []);
  const [retry, setRetry] = useState<{ phase: 'idle' | 'waiting' | 'connecting' | 'exhausted' | 'stopped'; attempt: number; seconds: number }>({ phase: 'idle', attempt: 0, seconds: 0 });
  const retryDeadline = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnect = useCallback(async () => {
    // A manual retry supersedes a scheduled one and restarts the attempt budget.
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    reconnectAttemptsRef.current = 0;
    await closeSessionRef.current();
    setFrame(null);
    setRetry({ phase: 'idle', attempt: 0, seconds: 0 });
    setAttempt(value => value + 1);
  }, []);
  const stopReconnect = useCallback(async () => {
    await closeSessionRef.current();
    setRetry(previous => ({ ...previous, phase: 'stopped', seconds: 0 }));
  }, []);
  useEffect(() => {
    if (retry.phase !== 'waiting') return;
    const timer = setInterval(() => setRetry(previous => ({ ...previous, seconds: Math.max(0, Math.ceil((retryDeadline.current - Date.now()) / 1000)) })), 250);
    return () => clearInterval(timer);
  }, [retry.phase]);

  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const connectionOutputRef = useRef(onConnectionOutput);
  connectionOutputRef.current = onConnectionOutput;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setStatus('connecting');
    setSshAuthenticated(false);
    useTerminalStore.getState().setStartupState(paneId, 'starting');

    const term = new Terminal({
      ...getTerminalFontOptions(),
      cursorBlink: useTypographyStore.getState().terminalCursorBlink,
      // A solid inactive cursor stays visible when the command input takes focus;
      // the default hairline outline reads as a vanished cursor on Retina displays.
      cursorInactiveStyle: 'block',
      scrollback: 5000,
      // The scrollbar width also sizes the overview ruler lane and the fit calculation.
      scrollbar: { width: 10, overviewRuler: { showTopBorder: false, showBottomBorder: false } },
      allowTransparency: false,
      theme: readXtermTheme(),
    });
    // Keep the typography preference in charge of blinking while still honoring
    // cursor-shape requests from running programs.
    applyTerminalCursorPreference(term);
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    // WebGL draws glyphs into GPU textures aligned to the cell grid, so half-block characters
    // join without a seam; the DOM renderer lays their CSS line boxes on the font baseline and
    // always leaves a gap. The shared helper steps down to the DOM renderer when the GPU context
    // is lost or WebGL is unavailable.
    loadWebglRenderer(term, useTypographyStore.getState().terminalRenderer);
    term.open(el);
    configureTerminalInput(term);
    captureTerminalPaste(term, paneId);
    let frameRaf = 0;
    // The connection frame is captured when output arrives; a pure resize changes the
    // terminal's column count without writing, so it is refreshed on layout changes too to
    // keep the frozen authentication screen at the pane's current width.
    const scheduleFrameCapture = (reason: 'write' | 'resize') => {
      if (spec?.kind !== 'ssh' || frameRaf) return;
      frameRaf = requestAnimationFrame(() => {
        frameRaf = 0;
        setFrame(previous => {
          const next = captureConnectionFrame(term, previous, stopped || connectionFailed);
          if (isTerminalDebugEnabled()) {
            terminalDebug('ssh-frame-capture', { paneId, reason, cols: term.cols, rows: term.rows,
              previousCols: previous?.cols ?? null, previousRows: previous?.rows ?? null, reused: next === previous });
          }
          return next;
        });
      });
    };
    const frameSub = term.onWriteParsed?.(() => scheduleFrameCapture('write'));
    fitTerminal(term, fit);
    registerTerminal(paneId, term);
    useTerminalStore.getState().setDims(paneId, term.cols, term.rows);

    let sessionId: string | null = null;
    const resizeQueue = createResizeQueue((cols, rows) => sessionId ? ptyResize(sessionId, cols, rows) : Promise.resolve(), 120);
    let disposed = false;
    let stopped = false;
    let connectionFailed = false;
    const startupAbort = new AbortController();
    // spawn 完成前的初始输出缓冲（shell 启动提示符）：拿到 sessionId 后回放，避免丢失
    let preSession: { id: string; events: DispatchEvent[] }[] = [];
    const pendingUnlisteners: Promise<UnlistenFn>[] = [];
    let focusTimer: ReturnType<typeof setTimeout> | null = null;
    const close = async () => {
      setRetry(previous => previous.phase === 'idle' ? previous : { ...previous, phase: 'stopped', seconds: 0 });
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (disposed || stopped) return;
      stopped = true;
      if (isTerminalDebugEnabled()) {
        terminalDebug('session-close-request', { paneId, tabId: ownerTab.current, hasSession: Boolean(sessionId) });
      }
      const id = sessionId;
      try {
        if (id) await ptyClose(id);
      } catch (reason) {
        stopped = false;
        throw reason;
      }
      startupAbort.abort();
      sessionId = null;
      preSession = [];
      useTerminalStore.getState().clearSession(paneId, id ?? undefined);
      if (spec?.kind === 'ssh') setFrame(previous => captureConnectionFrame(term, previous, true));
      setStatus('closed');
    };
    closeSessionRef.current = close;

    // ── 管线：controller（扫描已在 Rust 端完成，这里直接消费事件） ──

    // 从窗口布局取该终端的打开模式（paneId 即终端 id）
    const tab = useSessionStore.getState().tabs.find((t) => t.id === ownerTab.current);
    const spec = tab && tab.kind === 'session'
      ? layoutLeaves(tab.layout).find((t) => t.id === paneId)
      : undefined;
    const autoReconnect = spec?.kind === 'ssh' && spec.ssh?.autoReconnect === true;
    let automaticForwardingStarted = false;

    /**
     * Open a fresh session after an unexpected drop. A clean exit (the remote shell ended on
     * purpose) is left to the manual reconnect button, and so is a user-initiated close: that
     * path sets `stopped` before the exit event arrives.
     */
    const scheduleAutoReconnect = (code: number | null) => {
      if (!autoReconnect || disposed || (code !== 255 && code !== null)) return;
      if (reconnectAttemptsRef.current >= SSH_RECONNECT_MAX_ATTEMPTS) {
        setRetry({ phase: 'exhausted', attempt: SSH_RECONNECT_MAX_ATTEMPTS, seconds: 0 }); return;
      }
      const delay = Math.min(SSH_RECONNECT_BASE_MS * 2 ** reconnectAttemptsRef.current, SSH_RECONNECT_MAX_MS);
      reconnectAttemptsRef.current += 1;
      retryDeadline.current = Date.now() + delay;
      setRetry({ phase: 'waiting', attempt: reconnectAttemptsRef.current, seconds: delay / 1000 });
      if (isTerminalDebugEnabled()) {
        terminalDebug('ssh-auto-reconnect', { paneId, attempt: reconnectAttemptsRef.current, delayMs: delay });
      }
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        if (!disposed) { setRetry(previous => ({ ...previous, phase: 'connecting', seconds: 0 })); setAttempt(value => value + 1); }
      }, delay);
    };

    // 打开模式：spec.openMode 优先；老会话缺省时 SSH 回退 classic、local 按 shell 类型
    // Shells without integration must remain interactive, including restored sessions.
    const openMode = spec?.kind === 'local' && spec.shellType === 'cmd' ? 'classic'
      : spec?.openMode ?? (spec?.kind === 'ssh' ? 'classic' : defaultOpenModeForShell(spec?.shellType));
    const blockEnabled = openMode === 'block';
    // Block mode injects shell integration, which reports the command line through OSC 133;E.
    // Waiting for that marker keeps the visible command authoritative and prevents a late prompt
    // from closing an eager block.
    const deferBlockUntilPreexec = blockEnabled;
    // Remote authentication must remain interactive until shell integration announces its prompt.
    const initialScene: 'classic' | 'blockList' = blockEnabled && spec?.kind !== 'ssh' ? 'blockList' : 'classic';
    if (isTerminalDebugEnabled()) {
      // A duplicate mount for the same pane means the pane was torn down and
      // rebuilt (SSH would then re-authenticate from scratch); correlate it with
      // the dispose marker to spot an unexpected remount.
      terminalDebug('session-mount', { paneId, tabId: ownerTab.current, attempt, kind: spec?.kind ?? 'none', openMode });
    }

    // The local scene mirror determines whether the PTY uses full or block-list width.
    let currentScene: 'classic' | 'blockList' | 'altScreen' = initialScene;
    const writeMain = (data: string) => {
      const queuedAt = performance.now();
      term.write(data, () => {
        // The callback runs once the parser has drained up to this write, so its delay is the
        // backlog the output sat behind - what a stalled or throttled main thread turns into
        // seconds of lag.
        const lagMs = performance.now() - queuedAt;
        if (isTerminalDebugEnabled() && lagMs >= TERMINAL_PARSE_LAG_REPORT_MS) {
          terminalDebug('terminal-parse-lag', { paneId, chars: data.length, lagMs: Math.round(lagMs), scene: currentScene });
        }
        if (spec?.kind === 'ssh' && currentScene === 'classic') {
          connectionOutputRef.current?.(getRecentOutputFor(paneId, 100));
        }
      });
    };
    const controller = new SessionController(paneId, term.cols, {      writeMain,
      onTerminalData: data => {
        if (!sessionId || disposed || stopped) return;
        terminalDebug('block-terminal-data', { paneId, sessionId, chars: data.length, scene: currentScene });
        void writeTerminalInput(sessionId, data).catch(error => {
          terminalDebug('pty-write-error', { paneId, sessionId, source: 'block-xterm', errorType: error instanceof Error ? error.name : typeof error });
        });
      },
      onBlocksChanged: () => {
        const prev = useBlockStore.getState().byTab[paneId] ?? [];
        const next = projectBlocks(controller.blocks, prev, id => agentControl.hasBlock(id));
        if (next !== prev) useBlockStore.getState().setBlocks(paneId, next);
      },
      onSceneChanged: (scene) => {
        if (focusTimer) clearTimeout(focusTimer);
        currentScene = scene;
        useTerminalStore.getState().setScene(paneId, scene);
        // Controller transitions reclaim this pane's surface from manual presentation. A real
        // alternate buffer must never sit behind a stale overlay of the running block terminal.
        if (useTerminalStore.getState().manualFullscreen[paneId]) {
          useTerminalStore.getState().setManualFullscreen(paneId, false);
          if (isTerminalDebugEnabled()) {
            terminalDebug('manual-fullscreen-cancelled', { paneId, reason: scene });
          }
        }
        if (useSessionStore.getState().activeId !== ownerTab.current || !['terminal', 'unified'].includes(useWorkspaceNavigation.getState().area) || useUiStore.getState().settingsOpen) return;
        if (scene === 'blockList') {
          term.reset(); // 清掉 classic 残留
          useTerminalStore.getState().setKeyboardTarget('input');
        } else {
          useTerminalStore.getState().setKeyboardTarget('terminal');
          focusTimer = setTimeout(() => {
            if (disposed || currentScene !== scene || useSessionStore.getState().activeId !== ownerTab.current || !['terminal', 'unified'].includes(useWorkspaceNavigation.getState().area) || useUiStore.getState().settingsOpen || document.activeElement?.closest('.ai-workspace-surface')) return;
            term.focus();
            const textarea = term.element?.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea');
            if (isTerminalDebugEnabled()) {
              terminalDebug('terminal-scene-focus', {
                paneId,
                scene,
                focused: Boolean(textarea && document.activeElement === textarea),
                mounted: Boolean(term.element),
              });
            }
          }, 50);
        }
        // Recheck the PTY width when switching between full-width and block-list scenes.
        applyWidth();
      },
      onCwd: (path) => {
        useSessionStore.getState().setTerminalCwd(paneId, path);
      },
      onProgramTitle: (title) => {
        useSessionStore.getState().setProgramTitle(paneId, title);
      },
      onBlockStart: (block) => {
        if (spec) captureHistoryCommand(spec, paneId, block);
        sessionManager.record(ownerTab.current, paneId, block, 'start');
        // 惯用命名：标题跟随「聚焦终端」的首条命令（未定名时）
        if (block.command && paneId === useTerminalStore.getState().focusedPaneId) {
          useSessionStore.getState().titleFromCommand(ownerTab.current, block.command);
        }
      },
      onBlockComplete: (block) => {
        if (spec) captureHistoryCommand(spec, paneId, block);
        useHistoryStore.getState().record(block.command, block.cwd ?? '', block.exitCode);
        sessionManager.record(ownerTab.current, paneId, block, 'complete');
        // Return a manually fullscreened running block to the block list when it ends.
        const ts = useTerminalStore.getState();
        if (ts.manualFullscreen[paneId]) {
          ts.setScene(paneId, 'blockList');
          ts.setManualFullscreen(paneId, false);
        }
      },
      takePendingUiCommand: () => {
        const pending = pendingUiCommands.get(paneId);
        if (!pending) return null;
        pendingUiCommands.delete(paneId);
        if (Date.now() - pending.stagedAt > PENDING_COMMAND_TTL_MS) {
          if (isTerminalDebugEnabled()) {
            terminalDebug('command-pending-expired', { paneId, chars: pending.command.length });
          }
          return null;
        }
        return { command: pending.command, wireCommand: pending.wireCommand };
      },
      clearPendingUiCommand: () => {
        pendingUiCommands.delete(paneId);
      },
    }, term.rows, initialScene, blockEnabled, deferBlockUntilPreexec);
    sessionControllers.set(paneId, controller);
    setPendingCommandRegistrar((targetPane, command, payload) => {
      if (sessionControllers.has(targetPane)) setPendingTerminalCommand(targetPane, command, payload);
    });
    if (isTerminalDebugEnabled()) {
      terminalDebug('session-controller-register', { paneId, tabId: ownerTab.current, scene: initialScene, blockEnabled, deferBlockUntilPreexec });
    }
    // 初始场景手动落位（无 OSC 133 触发）：
    // blockList → 清 classic 残留、焦点到输入栏；classic → 焦点到 xterm 直接打字
    if (initialScene === 'blockList') {
      useTerminalStore.getState().setScene(paneId, 'blockList');
      term.reset();
      useTerminalStore.getState().setKeyboardTarget('input');
    } else {
      useTerminalStore.getState().setScene(paneId, 'classic');
      useTerminalStore.getState().setKeyboardTarget('terminal');
      focusTimer = setTimeout(() => {
        if (!(spec?.kind === 'ssh' && blockEnabled && connectionOutputRef.current)) term.focus();
        const textarea = term.element?.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea');
        if (isTerminalDebugEnabled()) {
          terminalDebug('terminal-scene-focus', {
            paneId,
            scene: initialScene,
            focused: Boolean(textarea && document.activeElement === textarea),
            mounted: Boolean(term.element),
          });
        }
      }, 50);
    }

    // 会话恢复：restore 已把持久化 block 按 pane 写进 store（在 addTab 之前），
    // 这里播种进 controller，避免首次 onBlocksChanged 用空列表覆盖恢复结果。
    const restoredBlocks = useBlockStore.getState().byTab[paneId] ?? [];
    if (restoredBlocks.length > 0) {
      controller.seed(restoredBlocks);
    }

    let startupTimer: ReturnType<typeof setTimeout> | undefined;
    let idleFallbackTimer: ReturnType<typeof setTimeout> | undefined;
    let promptReady = false;
    let startupComplete = false;
    const markInputReady = (integrated: boolean) => {
      if (disposed || stopped || !sessionId) return;
      if (startupComplete) return;
      clearTimeout(startupTimer);
      clearTimeout(idleFallbackTimer);
      startupComplete = true;
      setRetry(previous => ({ ...previous, phase: 'idle', seconds: 0 }));
      // Only a shell integration marker proves that SSH authentication completed. Output
      // silence can also be an authentication prompt and must not renew the retry budget.
      if (spec?.kind !== 'ssh') reconnectAttemptsRef.current = 0;
      useTerminalStore.getState().setStartupState(paneId, 'ready');
      terminalDebug('shell-input-ready', { paneId, sessionId, integrated });
    };
    const handleOutput = (events: DispatchEvent[]) => {
      controller.handleEvents(events);
      if (spec?.kind === 'ssh') {
        // Shell output must never enter the connection log, including non-integrated sessions.
        const output = events
          .filter((event): event is Extract<DispatchEvent, { kind: 'data' }> => event.kind === 'data')
          .map((event) => event.text)
          .join('');
        const time = Date.now();
        const lines = output ? connectionLogLines(output).filter(isSshClientNotice) : [];
        if (lines.length) setSshLog(entries => lines.reduce((log, line) => appendLogEntry(log, { time, text: line }), entries));
      }
      // A real prompt marker also renews the budget after an earlier idle-readiness fallback.
      if (events.some(event => event.kind === 'osc' && event.code === '133;B')) {
        promptReady = true;
        if (spec?.kind === 'ssh') setSshAuthenticated(true);
        if (spec?.kind === 'ssh' && spec.ssh?.connectionId && !automaticForwardingStarted) {
          automaticForwardingStarted = true;
          void startAutomaticForwarding(spec.ssh.connectionId).catch(reason => {
            useToastStore.getState().addToast(`${t('Port forwarding failed')}: ${String(reason)}`, 'error');
          });
        }
        if (spec?.kind === 'ssh') reconnectAttemptsRef.current = 0;
        if (spec?.kind === 'ssh') setSshLog(entries => appendLogEntry(entries, { time: Date.now(), text: t('Shell ready') }));
      }
      if (startupComplete) return;
      // Non-integrated command shells have no OSC readiness marker.
      const plainShellOutput = spec?.kind === 'local' && spec.shellType === 'cmd'
        && events.some(event => event.kind === 'data' && event.text.length > 0);
      if (promptReady || plainShellOutput) {
        clearTimeout(startupTimer);
        clearTimeout(idleFallbackTimer);
        // Let the line editor finish its initial repaint before injecting a command.
        startupTimer = setTimeout(() => markInputReady(promptReady), 150);
        return;
      }
      // Shells whose hooks predate the ready marker (or that never send one) would
      // otherwise block the queued command forever. Output that stops for this long
      // means the shell is sitting at its prompt, so type there and record why.
      clearTimeout(idleFallbackTimer);
      idleFallbackTimer = setTimeout(() => markInputReady(false), SHELL_IDLE_READY_MS);
    };

    // Register output before spawning to retain startup markers.

    pendingUnlisteners.push(
      onPtyOutput((id, events) => {
        if (disposed || stopped) return;
        // Sessions from a previous page can still exist in the backend: drop their
        // output before building any string so a stale TUI cannot cost this pane work.
        if (sessionId !== null && id !== sessionId) return;
        // The request for win32-input-mode arrives in the session output; the
        // matching key encoding happens at the input side.
        const output = events
          .filter((event): event is Extract<DispatchEvent, { kind: 'data' }> => event.kind === 'data')
          .map((event) => event.text)
          .join('');
        if (output) {
          // Questions the program expects the terminal to answer; a line here shows what
          // a session is waiting on without recording the output itself.
          const queries = querySequences(output);
          if (queries.length > 0) terminalDebug('terminal-queries', { id, queries });
        }
        if (sessionId === null) {
          // 尚未拿到 sessionId：先缓冲，等 spawn 完成后回放
          if (preSession.length < PRE_SESSION_MAX_BATCHES) preSession.push({ id, events });
          return;
        }
        controller.ioLog.received(events);
        handleOutput(events);
      }),
    );

    pendingUnlisteners.push(
      onPtyExit((id, code) => {
        if (disposed || stopped) return;
        if (isTerminalDebugEnabled()) terminalDebug('pty-exit', { id, sessionId, code });
        if (id === sessionId) {
          // The PTY is gone: input still queued would only fail chunk by chunk, and a
          // block that was executing can never complete its shell integration now.
          cancelTerminalInput(id);
          controller.interruptActive();
          sessionId = null;
          stopped = true;
          useTerminalStore.getState().clearSession(paneId, id);
          setStatus('closed');
          writeMain(`\r\n\x1b[31m${t('terminal.processExited')}\x1b[0m\r\n`);
          if (spec?.kind === 'ssh') setSshLog(entries => appendLogEntry(entries, { time: Date.now(), text: code == null ? t('Connection ended') : t('Connection ended (exit code {{code}})', { code }) }));
          if (code !== 255 && code !== null) setRetry(previous => ({ ...previous, phase: 'idle', seconds: 0 }));
          scheduleAutoReconnect(code);
        }
      }),
    );

    // ── PTY 启动 ──

    // 类型/cwd 已在 controller 创建前取好（spec）
    let tabCwd = spec?.cwd;
    const spawnOpts: PtySpawnOptions | undefined = spec?.kind === 'ssh'
      ? { ssh: { host: spec.ssh?.host ?? '', user: spec.ssh?.user, port: spec.ssh?.port,
        identityFile: spec.ssh?.identityFile, jumpHost: spec.ssh?.jumpHost,
        serverAliveInterval: spec.ssh?.serverAliveInterval, shellIntegration: spec.ssh?.shellIntegration,
        localForwards: spec.ssh?.localForwards, remoteForwards: spec.ssh?.remoteForwards,
        dynamicForwards: spec.ssh?.dynamicForwards, proxyId: spec.ssh?.proxyId, environment: spec.ssh?.environment, authenticationMode: spec.ssh?.authenticationMode }, openMode }
      : spec?.kind === 'local'
        ? { shell: spec.shellType, openMode }
        : undefined;
    // 分屏 pane 初次挂载时容器可能尚未布局，fit 会算出 0×0；用兜底尺寸先启动，
    // 等 ResizeObserver/就绪后重校到真实尺寸，避免 PTY 以 0×0 启动导致空白。
    const spawnCols = term.cols > 0 ? term.cols : 80;
    const spawnRows = term.rows > 0 ? term.rows : 24;
    if (isTerminalDebugEnabled()) {
      terminalDebug('pty-spawn-request', { paneId, tabId: ownerTab.current, cols: spawnCols, rows: spawnRows, spawnOpts });
    }
    const startSession = async () => {
      if (spec?.kind === 'local' && spawnOpts) {
        const shells = await getAvailableShells();
        spawnOpts.shell = preferredShell(spec.shellType as ShellType ?? 'system', shells);
        const profile = spawnOpts.shell ? useShellProfiles.getState().profiles[spawnOpts.shell as ShellType] : undefined;
        if (spec.useProfileDirectory !== false) tabCwd ??= profile?.cwd || undefined;
      }
      if (spawnOpts?.ssh && (!spawnOpts.ssh.jumpHost || spawnOpts.ssh.jumpHost.toLowerCase() === 'none')) {
        try {
          const info = await prepareSshHost(spawnOpts.ssh.host, spawnOpts.ssh.port, startupAbort.signal, spawnOpts.ssh);
          spawnOpts.ssh.hostKeyType = info.keyType;
        } catch (error) {
          const message = String((error as Error)?.message ?? error);
          // 用户主动取消，或已记录的主机密钥发生变化（可能是中间人）时必须停下。
          if (message.includes('已取消') || message.includes('主机密钥不匹配')) throw error;
          // 预检只是「提前看指纹」，它失败（例如老服务器无法与预检库协商算法）不应该
          // 让可用的 ssh 无法启动：改由 ssh 自己校验，未知指纹在终端里询问。
          if (isTerminalDebugEnabled()) terminalDebug('ssh-preflight-unavailable', { paneId });
          spawnOpts.ssh.hostKeyPolicy = 'ask';
        }
      }
      if (disposed || stopped) throw new Error('已取消连接');
      return ptySpawn(spawnCols, spawnRows, tabCwd, spawnOpts);
    };
    startSession()
      .then((id) => {
        if (disposed || stopped) {
          ptyClose(id).catch(() => {});
          return;
        }
        sessionId = id;
        if (spec?.kind === 'local' && spawnOpts?.shell) {
          const shell = spawnOpts.shell;
          useTerminalStore.setState(state => ({ shellTypes: { ...state.shellTypes, [paneId]: shell } }));
        }
        if (isTerminalDebugEnabled()) terminalDebug('pty-spawn-ready', { paneId, id });
        // 回放 spawn 完成前缓冲的初始输出（shell 启动提示符）
        for (const ev of preSession) {
          if (ev.id === sessionId) {
            handleOutput(ev.events);
          }
        }
        preSession = [];
        onReadyRef.current(id);
        setStatus('ready');
        if (currentScene === 'classic' && useSessionStore.getState().activeId === ownerTab.current && ['terminal', 'unified'].includes(useWorkspaceNavigation.getState().area) && !useUiStore.getState().settingsOpen && !document.activeElement?.closest('.ai-workspace-surface') && !(spec?.kind === 'ssh' && blockEnabled && connectionOutputRef.current)) {
          term.focus();
        }
        // PTY 就绪后按真实布局尺寸重校
        requestAnimationFrame(() => {
          if (disposed || el.offsetWidth === 0 || el.offsetHeight === 0) return;
          fitTerminal(term, fit);
          useTerminalStore.getState().setDims(paneId, term.cols, term.rows);
          resizeQueue.request(term.cols, term.rows);
          controller.resize(term.cols, term.rows);
        });
      })
      .catch((e) => {
        if (!disposed && !stopped) {
          setRetry(previous => ({ ...previous, phase: 'stopped', seconds: 0 }));
          connectionFailed = true;
          useTerminalStore.getState().setStartupState(paneId, 'failed');
          setStatus('error');
          if (isTerminalDebugEnabled()) {
            terminalDebug('pty-spawn-error', { paneId, errorType: e instanceof Error ? e.name : typeof e });
          }
          console.error('[useTerminalSession] PTY spawn failed:', e);
          writeMain(`\r\n\x1b[31m[${spec?.kind === 'ssh' ? 'SSH 连接失败' : '无法启动 Shell'}：${e}]\x1b[0m\r\n`);
        }
      });

    // ── 用户输入（xterm 聚焦时：classic/altScreen，及 blockList 运行中块） ──

    // blockList 下 End 保留给「回到输入栏」（InputEditor 的全局监听会接住），
    // 不能漏进 PTY（xterm 默认会发 \x1b[F）
    term.attachCustomKeyEventHandler((e) => {
      // 复制/粘贴归终端：Ctrl+C 有选区时复制（没有选区仍是 PTY 的中断），Ctrl+V 粘贴；
      // Ctrl+Shift+C/V 同样有效。
      if (e.type === 'keydown' && (e.ctrlKey || e.metaKey) && !e.altKey) {
        const key = e.key.toLowerCase();
        const copy = key === 'c' && (e.metaKey || e.shiftKey || term.hasSelection());
        const paste = key === 'v';
        if (copy || paste) {
          e.preventDefault();
          if (copy) void copyTerminalSelection(term);
          else void pasteClipboardIntoTerminal(paneId);
          return false;
        }
      }
      if (e.type === 'keydown' && e.key === 'End') {
        const scene = useTerminalStore.getState().scenes[paneId] ?? 'classic';
        if (scene === 'blockList') return false;
      }
      return true;
    });

    // ── Alternate-buffer wheel fallback: wheel → arrow keys ──
    // The alternate buffer has no scrollback, so the built-in wheel handling is a no-op
    // there (in a TUI the wheel appears to do nothing). While the foreground program has
    // not enabled mouse reporting, translate wheel movement into line-by-line ↑/↓ keys
    // for the PTY; with mouse reporting enabled the events pass through to xterm's
    // default handling.
    let wheelResidual = 0;
    term.attachCustomWheelEventHandler((e) => {
      if (term.buffer.active.type !== 'alternate' || term.modes.mouseTrackingMode !== 'none') {
        wheelResidual = 0;
        return true;
      }
      if (!sessionId) return false;
      // Use the renderer's measured row height when converting wheel movement to keys.
      const linePx = Math.max(1, getCellMetrics(term).height);
      if (Math.sign(e.deltaY) !== Math.sign(wheelResidual)) wheelResidual = 0;
      wheelResidual += e.deltaY;
      const lines = Math.trunc(wheelResidual / linePx);
      if (lines === 0) return false;
      wheelResidual -= lines * linePx;
      const seq = (lines < 0 ? '\x1b[A' : '\x1b[B').repeat(Math.min(Math.abs(lines), term.rows));
      ptyWrite(sessionId, seq).catch(() => {});
      return false;
    });

    let pendingInputAt: number | null = null;
    const inputRenderSub = term.onRender?.(() => {
      if (pendingInputAt === null) return;
      terminalDebug('terminal-input-render-complete', { paneId, scene: currentScene,
        durationMs: Math.round((performance.now() - pendingInputAt) * 10) / 10 });
      pendingInputAt = null;
    });
    const dataSub = term.onData((data) => {
      if (sessionId && !stopped) {
        const inputScene = currentScene;
        if (isTerminalDebugEnabled()) {
          pendingInputAt ??= performance.now();
          terminalDebug('terminal-input', {
            paneId,
            sessionId,
            scene: inputScene,
            buffer: term.buffer.active.type,
            chars: data.length,
          });
        }
        writeTerminalInput(sessionId, data).then(() => {
          if (isTerminalDebugEnabled()) {
            terminalDebug('terminal-input-write-complete', { paneId, sessionId, chars: data.length });
          }
        }).catch((error) => {
          if (isTerminalDebugEnabled()) {
            terminalDebug('pty-write-error', { paneId, sessionId, source: 'main-xterm', errorType: error instanceof Error ? error.name : typeof error });
          }
        });
      }
    });

    // ── Resize ──
    // Classic and alternate-screen scenes use the main xterm width. In block-list
    // mode, match the PTY to the visible output width so wrapped lines stay intact.

    /** 实测字符宽（渲染服务内部尺寸，与 RunningTerm 的 cellHeight 同源） */
    const cellWidth = (): number => getCellMetrics(term).width;

    /**
     * Return the manual fullscreen host size, or null when it is inactive.
     */
    const fullscreenHostSize = (): { w: number; h: number } | null => {
      if (!useTerminalStore.getState().manualFullscreen[paneId]) return null;
      const fsHost = document.querySelector<HTMLElement>(`[data-testid="tui-fullscreen"][data-pane-id="${paneId}"]`);
      if (!fsHost) return null;
      const style = getComputedStyle(fsHost);
      return { w: fsHost.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0),
        h: fsHost.clientHeight - (parseFloat(style.paddingTop) || 0) - (parseFloat(style.paddingBottom) || 0) };
    };

    let cachedDomCellWidth = 0;
    const domCellWidth = (): number => {
      if (cachedDomCellWidth > 0) return cachedDomCellWidth;
      const measured = measureTerminalDomCellWidth();
      cachedDomCellWidth = measured > 0 ? measured : cellWidth();
      return cachedDomCellWidth;
    };

    /** PTY column count leaves room for browser fallback glyphs in completed snapshots. */
    const effectiveCols = (): number => {
      const scene = useTerminalStore.getState().scenes[paneId] ?? currentScene;
      const manualFullscreen = useTerminalStore.getState().manualFullscreen[paneId];
      const fs = fullscreenHostSize();
      if (fs) {
        const output = controller.executingTerm?.term ?? term;
        if (fs.w > 0) return Math.max(2, Math.floor(fs.w / getCellMetrics(output).width));
        return output.cols;
      }
      if (scene !== 'blockList' && !manualFullscreen) return term.cols;
      // Measure a mounted output host to account for its padding and scrollbars.
      // Before it mounts, estimate the content width from the main terminal container.
      const pane = document.querySelector<HTMLElement>(`[data-testid="pane-${paneId}"]`);
      const host = pane?.querySelector<HTMLElement>('[data-testid="running-term"]');
      const list = pane?.querySelector<HTMLElement>(`[data-testid="terminal-scroll-${paneId}"]`);
      const screenPx = host
        ? host.clientWidth
        : (list?.clientWidth || el.offsetWidth) - (list
          ? parseFloat(getComputedStyle(list).getPropertyValue('--command-content-inset')) || BLOCK_CONTENT_INSET_PX
          : BLOCK_CONTENT_INSET_PX);
      // A hidden or not-yet-laid-out host has no measurable width; retry after mount.
      if (screenPx <= 0) return term.cols;
      // The visible block owns its grid. The hidden main terminal can retain a smaller
      // column count or different font metrics after layout and font changes.
      const outputTerm = controller.executingTerm?.term;
      const advance = host && outputTerm?.element ? getCellMetrics(outputTerm).width : domCellWidth();
      return Math.max(2, Math.floor(screenPx / advance));
    };

    /** PTY row count for the current scene; manual fullscreen uses the host height. */
    const effectiveRows = (): number => {
      const fs = fullscreenHostSize();
      if (fs) {
        const output = controller.executingTerm?.term ?? term;
        if (fs.h > 0) return Math.max(1, Math.floor(fs.h / getCellMetrics(output).height));
        return output.rows;
      }
      return term.rows;
    };

    let widthRaf = 0;
    let deferredPtySize: { cols: number; rows: number } | null = null;
    // Idle prompts defer layout-drag notifications to avoid repeated prompt redraws.
    // Running programs receive coalesced sizes during the drag so they can reflow immediately.
    const requestPtySize = (cols: number, rows: number) => {
      if (!sessionId) return;
      if (isLayoutResizeDragActive() && !controller.executingTerm) { deferredPtySize = { cols, rows }; return; }
      deferredPtySize = null;
      resizeQueue.request(cols, rows);
    };
    const applyWidth = () => {
      if (widthRaf) return;
      widthRaf = requestAnimationFrame(() => {
        widthRaf = 0;
        // 后台标签 display:none 宽度为 0，别把 PTY 挤成 2 列
        if (el.offsetWidth === 0) return;
        const previousCols = term.cols;
        const previousRows = term.rows;
        fitTerminal(term, fit);
        const sizeChanged = previousCols !== term.cols || previousRows !== term.rows;
        // A resize re-lays the buffer; re-capture so the frozen connection frame follows it.
        if (sizeChanged) scheduleFrameCapture('resize');
        if (isTerminalDebugEnabled() && sizeChanged) {
          const screen = term.element?.querySelector('.xterm-screen')?.getBoundingClientRect();
          const host = el.getBoundingClientRect();
          terminalDebug('terminal-resize-frame', { paneId, scene: currentScene, previousCols, previousRows,
            cols: term.cols, rows: term.rows, hostWidth: host.width, hostHeight: host.height,
            screenOffsetX: screen ? screen.left - host.left : null, screenWidth: screen?.width,
            cellWidth: getCellMetrics(term).width, devicePixelRatio: window.devicePixelRatio });
        }
        const scene = useTerminalStore.getState().scenes[paneId] ?? currentScene;
        const manualRequested = !!useTerminalStore.getState().manualFullscreen[paneId];
        const manual = manualRequested && fullscreenHostSize() !== null;
        if (!manual) useTerminalStore.getState().setDims(paneId, term.cols, term.rows);
        if (scene === 'altScreen' && !manualRequested) {
          // A real alternate buffer uses the main terminal's measured grid.
          requestPtySize(term.cols, term.rows);
          controller.resize(term.cols, term.rows);
          return;
        }
        const cols = effectiveCols();
        const rows = effectiveRows();
        if (cols <= 0 || rows <= 0) return;
        if (manual) useTerminalStore.getState().setDims(paneId, cols, rows);
        if (useTerminalStore.getState().manualFullscreen[paneId] && controller.executingTerm
          && (controller.executingTerm.term.cols !== cols || controller.executingTerm.term.rows !== rows)) {
          terminalDebug('manual-fullscreen-resize', { paneId, cols, rows });
        }
        requestPtySize(cols, rows);
        controller.resize(cols, rows);
        if (isTerminalDebugEnabled()) {
          const output = controller.executingTerm;
          if (output) terminalDebug('running-terminal-width', { paneId, cols, rows, mainCols: term.cols,
            mainHostWidth: el.clientWidth, mainHostHeight: el.clientHeight,
            blockCols: output.term.cols, cellWidth: getCellMetrics(output.term).width,
            screenWidth: output.el.querySelector('.xterm-screen')?.getBoundingClientRect().width });
        }
      });
    };
    widthSyncs.set(paneId, applyWidth);
    const unsubscribeLayoutDrag = onLayoutResizeDragEnd(() => {
      if (disposed || !deferredPtySize) return;
      const size = deferredPtySize;
      deferredPtySize = null;
      resizeQueue.request(size.cols, size.rows);
    });
    const unsubscribeTypography = useTypographyStore.subscribe((state, previous) => {
      if (state.terminalCursorBlink !== previous.terminalCursorBlink) term.options.cursorBlink = state.terminalCursorBlink;
      if (!terminalTypographyChanged(state, previous)) return;
      Object.assign(term.options, getTerminalFontOptions());
      cachedDomCellWidth = 0;
      if (el.offsetWidth > 0 && el.offsetHeight > 0) {
        fitTerminal(term, fit);
        useTerminalStore.getState().setDims(paneId, term.cols, term.rows);
        applyWidth();
      }
    });
    // The preferred face can finish loading after this terminal was created, so its first
    // measurement may hold a fallback advance that xterm keeps until an option changes (it does
    // not re-measure on resize). Re-apply the font options once the fonts settle and refit, so
    // the cell grid and the PTY columns follow the font that actually renders.
    if (typeof document !== 'undefined' && document.fonts) {
      void document.fonts.ready.then(() => {
        if (disposed) return;
        const wanted = getTerminalFontOptions();
        const changed = term.options.fontSize !== wanted.fontSize
          || term.options.fontFamily !== wanted.fontFamily
          || term.options.fontWeight !== wanted.fontWeight
          || term.options.letterSpacing !== wanted.letterSpacing;
        if (!changed) return;
        Object.assign(term.options, wanted);
        cachedDomCellWidth = 0;
        if (isTerminalDebugEnabled()) {
          terminalDebug('terminal-font-refresh', { paneId, fontSize: wanted.fontSize, letterSpacing: wanted.letterSpacing });
        }
        if (el.offsetWidth > 0 && el.offsetHeight > 0) {
          fitTerminal(term, fit);
          useTerminalStore.getState().setDims(paneId, term.cols, term.rows);
          applyWidth();
        }
      });
    }

    // A pane hidden with display:none (inactive tab or panel) can come back blank: a static
    // alternate-screen application prints nothing to trigger a repaint, and a WebGL context lost
    // while hidden steps down to the DOM renderer without drawing any rows. Restore the surface
    // on the way back and repaint from the buffer, leaving the shared glyph atlas alone.
    const restoreSurface = () => {
      if (disposed || el.offsetWidth === 0 || el.offsetHeight === 0) return;
      applyTerminalRenderer(term, useTypographyStore.getState().terminalRenderer);
      repaintTerminal(term);
      if (isTerminalDebugEnabled()) {
        terminalDebug('terminal-visibility-repaint', { paneId, scene: currentScene, cols: term.cols, rows: term.rows });
      }
    };
    let restoreRaf = 0;
    const unsubscribeActiveTab = useSessionStore.subscribe((state, previous) => {
      if (state.activeId !== ownerTab.current || state.activeId === previous.activeId) return;
      // The store changes before React reveals the pane. Repaint after layout even
      // when a rapid tab switch never produces a zero-size ResizeObserver entry.
      cancelAnimationFrame(restoreRaf);
      restoreRaf = requestAnimationFrame(() => { restoreSurface(); applyWidth(); });
    });
    let paneWasHidden = false;
    const ro = new ResizeObserver(() => {
      if (el.offsetWidth === 0 || el.offsetHeight === 0) {
        paneWasHidden = true;
        return;
      }
      if (paneWasHidden) {
        paneWasHidden = false;
        restoreSurface();
      }
      applyWidth();
    });
    ro.observe(el);
    // Coming back from a backgrounded window is a shared-atlas reset: the renderer reset and the
    // repaint cover every live terminal, because a single terminal must never clear the glyph
    // atlas that the others hold texture coordinates into.
    const onVisibilityChange = () => { if (!document.hidden) recoverTerminalSurfaces(); };
    document.addEventListener('visibilitychange', onVisibilityChange);
    // The platform does not always deliver a visibility change when the window leaves and comes
    // back, so the return is also observed through focus. The record carries how long the app was
    // away and which renderer each surface came back with, which makes a silent step down to the
    // DOM renderer visible.
    let blurredAt: number | null = null;
    const onWindowBlur = () => { blurredAt = performance.now(); };
    const onWindowFocus = () => {
      if (disposed) return;
      const awayMs = blurredAt === null ? null : Math.round(performance.now() - blurredAt);
      blurredAt = null;
      const block = blockTerminalFor(paneId);
      terminalDebug('terminal-window-return', {
        paneId,
        awayMs,
        scene: currentScene,
        cols: term.cols,
        rows: term.rows,
        visibility: document.visibilityState,
        focused: document.hasFocus(),
        webgl: hasWebglRenderer(term),
        blockWebgl: block ? hasWebglRenderer(block) : null,
      });
    };
    window.addEventListener('blur', onWindowBlur);
    window.addEventListener('focus', onWindowFocus);

    // ── 清理 ──

    return () => {
      unsubscribeTypography();
      unsubscribeActiveTab();
      cancelAnimationFrame(restoreRaf);
      disposed = true;
      if (closeSessionRef.current === close) closeSessionRef.current = async () => {};
      startupAbort.abort();
      if (isTerminalDebugEnabled()) {
        terminalDebug('session-controller-dispose', { paneId, tabId: ownerTab.current, attempt, kind: spec?.kind ?? 'none', hasSession: Boolean(sessionId) });
      }
      if (focusTimer) {
        clearTimeout(focusTimer);
        focusTimer = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      clearTimeout(startupTimer);
      clearTimeout(idleFallbackTimer);
      frameSub?.dispose();
      cancelAnimationFrame(frameRaf);
      dataSub.dispose();
      inputRenderSub?.dispose();
      resizeQueue.dispose();
      unsubscribeLayoutDrag();
      cancelAnimationFrame(widthRaf);
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('blur', onWindowBlur);
      window.removeEventListener('focus', onWindowFocus);
      if (widthSyncs.get(paneId) === applyWidth) widthSyncs.delete(paneId);
      if (sessionControllers.get(paneId) === controller) sessionControllers.delete(paneId);
      pendingUiCommands.delete(paneId);
      controller.dispose();
      pendingUnlisteners.forEach((p) => p.then((u) => u()).catch(() => {}));
      if (sessionId) {
        // Queued input can no longer reach a session that is closing: drop it before the PTY goes.
        cancelTerminalInput(sessionId);
        useTerminalStore.getState().clearSession(paneId, sessionId);
        ptyClose(sessionId).catch(() => {});
      }
      useSessionStore.getState().setProgramTitle(paneId, '');
      unregisterTerminal(paneId, term);
      // Disposing the terminal disposes its addons, which drop the canvas but keep the GPU
      // context; hand it back so long sessions do not accumulate contexts.
      releaseTerminalRenderer(term);
      term.dispose();
    };
  }, [paneId, attempt]);

  return { ref: containerRef, closeSession, reconnect, stopReconnect, retry, status, frame, sshAuthenticated, sshLog };
}
