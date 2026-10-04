/**
 * useTerminalSession — 主 xterm 生命周期 + SessionController 接线。
 *
 * 主 xterm 只在 classic / altScreen 场景接收数据（blockList 下闲置隐藏）。
 */

import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { WebglAddon } from '@xterm/addon-webgl';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { ptySpawn, ptyWrite, ptyResize, ptyClose, onPtyOutput, onPtyExit } from '@platform/pty';
import { registerTerminal, unregisterTerminal, useTerminalStore } from '@features/terminal';
import { useBlockStore } from '@features/terminal';
import { useHistoryStore } from '@features/terminal/stores/history';
import { isTerminalDebugEnabled, terminalDebug } from '@features/terminal/services/terminalDebug';
import { readXtermTheme } from '@features/terminal/model/xtermTheme';
import { useSessionStore } from '@features/workspace';
import { leaves as layoutLeaves } from '@features/workspace/model/windowLayout';
import * as sessionManager from '@features/workspace/services/sessionManager';
import { agentControl } from '@features/agent/services/agentControl';
import { defaultOpenModeForShell } from '@features/agent/stores/agentSettings';
import { SessionController } from '@features/terminal/services/pipeline/sessionController';
import { getCellMetrics } from '@utils/termMetrics';
import type { DispatchEvent } from '@core/terminal/events';
import type { TermBlock } from '@features/terminal/services/pipeline/termBlock';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { TERMINAL_FONT_FAMILY, getTerminalFontSize, TERMINAL_LINE_HEIGHT } from '@features/terminal/model/terminalFont';
import { useTypographyStore } from '@config/typography';

/**
 * TermBlock UI 投影：剥离 controller 内部字段（outputTerm/earlyBuf 等）。
 * The store owns collapsed state, so preserve it by block ID when replacing the projection.
 * agentControl owns agent markers, which are looked up again during projection.
 */
function projectBlock(b: TermBlock, collapsed: boolean, agent: boolean): TermBlock {
  return {
    id: b.id,
    command: b.command,
    cwd: b.cwd,
    gitBranch: b.gitBranch,
    status: b.status,
    exitCode: b.exitCode,
    startedAt: b.startedAt,
    endedAt: b.endedAt,
    wasLongRunning: b.wasLongRunning,
    collapsed: collapsed || undefined,
    agent: agent || undefined,
    outputHtml: b.outputHtml,
    outputText: b.outputText,
    outputRaw: b.outputRaw,
    linesTruncated: b.linesTruncated,
  };
}

interface SessionRegistry {
  controllers: Map<string, SessionController>;
  pendingUiCommands: Map<string, { command: string; stagedAt: number }>;
  widthSyncs: Map<string, () => void>;
}

// Preserve live controller references when the renderer reloads a module during development.
const registryScope = globalThis as typeof globalThis & { __vrykellSessionRegistry?: SessionRegistry };
const sessionRegistry = registryScope.__vrykellSessionRegistry ??= {
  controllers: new Map<string, SessionController>(),
  pendingUiCommands: new Map<string, { command: string; stagedAt: number }>(),
  widthSyncs: new Map<string, () => void>(),
};
const sessionControllers = sessionRegistry.controllers;
const pendingUiCommands = sessionRegistry.pendingUiCommands;
const widthSyncs = sessionRegistry.widthSyncs;
const PENDING_COMMAND_TTL_MS = 30_000;

/** 清除指定 tab 的全部输出块；无存活 session 时退化为清 store。 */
export function clearSessionBlocks(tabId: string): void {
  const c = sessionControllers.get(tabId);
  if (c) c.clear();
  else useBlockStore.getState().clearBlocks(tabId);
}

export function setPendingTerminalCommand(tabId: string, command: string): void {
  const normalized = command.trim();
  if (!normalized) return;
  const controller = sessionControllers.get(tabId);
  if (!controller) {
    pendingUiCommands.set(tabId, { command: normalized, stagedAt: Date.now() });
    if (isTerminalDebugEnabled()) {
      terminalDebug('command-pending-deferred', { paneId: tabId, chars: normalized.length });
    }
    return;
  }
  const accepted = controller.setPendingCommand(normalized);
  if (accepted) pendingUiCommands.set(tabId, { command: normalized, stagedAt: Date.now() });
  else pendingUiCommands.delete(tabId);
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

/** Fallback width deduction for command insets, host padding, and xterm padding. */
const BLOCK_CONTENT_INSET_PX = 48;

export function useTerminalSession(
  paneId: string,
  tabId: string,
  onReady: (sessionId: string) => void,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const term = new Terminal({
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: getTerminalFontSize(),
      lineHeight: TERMINAL_LINE_HEIGHT,
      cursorBlink: true,
      scrollback: 5000,
      allowTransparency: false,
      theme: readXtermTheme(),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    // WebGL renderer：字形画进 GPU 纹理、按 cell 精确对齐，半块字符（▀▄）
    // 上下行拼接无缝 —— DOM renderer 的 CSS 行盒按字体 baseline 排布，
    // 半块字符之间必然留缝（TUI 图标/对话框出现横裂缝）。
    // 在 WKWebView 无 WebGL 时自动回退 DOM renderer（xterm 内部行为）。
    try {
      term.loadAddon(new WebglAddon());
    } catch {
      // 忽略：回退默认 DOM renderer（缝隙问题在无 GPU 环境无法根治）
    }
    term.open(el);
    fit.fit();
    registerTerminal(paneId, term);
    useTerminalStore.getState().setDims(paneId, term.cols, term.rows);

    let sessionId: string | null = null;
    let disposed = false;
    // spawn 完成前的初始输出缓冲（shell 启动提示符）：拿到 sessionId 后回放，避免丢失
    let preSession: { id: string; events: DispatchEvent[] }[] = [];
    const unlisteners: UnlistenFn[] = [];
    const pendingUnlisteners: Promise<UnlistenFn>[] = [];
    let focusTimer: ReturnType<typeof setTimeout> | null = null;

    // ── 管线：controller（扫描已在 Rust 端完成，这里直接消费事件） ──

    // 从窗口布局取该终端的打开模式（paneId 即终端 id）
    const tab = useSessionStore.getState().tabs.find((t) => t.id === tabId);
    const spec = tab && tab.kind === 'session'
      ? layoutLeaves(tab.layout).find((t) => t.id === paneId)
      : undefined;
    // 打开模式：spec.openMode 优先；老会话缺省时 SSH 回退 classic、local 按 shell 类型
    const openMode = spec?.openMode ?? (spec?.kind === 'ssh' ? 'classic' : defaultOpenModeForShell(spec?.shellType));
    const blockEnabled = openMode === 'block';
    const initialScene: 'classic' | 'blockList' = blockEnabled ? 'blockList' : 'classic';

    // The local scene mirror determines whether the PTY uses full or block-list width.
    let currentScene: 'classic' | 'blockList' | 'altScreen' = initialScene;
    const controller = new SessionController(paneId, term.cols, {      writeMain: (data) => term.write(data),
      onBlocksChanged: () => {
        const prev = useBlockStore.getState().byTab[paneId] ?? [];
        const collapsedIds = new Set(prev.filter((b) => b.collapsed).map((b) => b.id));
        useBlockStore.getState().setBlocks(
          paneId,
          controller.blocks.map((b) =>
            projectBlock(b, collapsedIds.has(b.id), agentControl.hasBlock(b.id)),
          ),
        );
      },
      onSceneChanged: (scene) => {
        currentScene = scene;
        useTerminalStore.getState().setScene(paneId, scene);
        if (useSessionStore.getState().activeId !== tabId) return;
        // Actual alternate-buffer mode is rendered by the main xterm, so do not mark it
        // as a manually fullscreened block terminal or the visible TUI would be hidden.
        if (scene === 'blockList') {
          term.reset(); // 清掉 classic 残留
          useTerminalStore.getState().setKeyboardTarget('input');
        } else {
          useTerminalStore.getState().setKeyboardTarget('terminal');
          focusTimer = setTimeout(() => {
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
      onBlockStart: (block) => {
        sessionManager.record(tabId, paneId, block, 'start');
        // 惯用命名：标题跟随「聚焦终端」的首条命令（未定名时）
        if (block.command && paneId === useTerminalStore.getState().focusedPaneId) {
          useSessionStore.getState().titleFromCommand(tabId, block.command);
        }
      },
      onBlockComplete: (block) => {
        useHistoryStore.getState().record(block.command, block.cwd ?? '', block.exitCode);
        sessionManager.record(tabId, paneId, block, 'complete');
        // Return a manually fullscreened running block to the block list when it ends.
        const ts = useTerminalStore.getState();
        if (ts.scenes[paneId] === 'altScreen') {
          ts.setScene(paneId, 'blockList');
          ts.setAltScreenActive(false);
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
        return pending.command;
      },
      clearPendingUiCommand: () => {
        pendingUiCommands.delete(paneId);
      },
    }, term.rows, initialScene, blockEnabled);
    sessionControllers.set(paneId, controller);
    if (isTerminalDebugEnabled()) {
      terminalDebug('session-controller-register', { paneId, tabId, scene: initialScene, blockEnabled });
    }
    // 初始场景手动落位（无 OSC 133 触发）：
    // blockList → 清 classic 残留、焦点到输入栏；classic → 焦点到 xterm 直接打字
    if (initialScene === 'blockList') {
      useTerminalStore.getState().setScene(paneId, 'blockList');
      term.reset();
      useTerminalStore.getState().setKeyboardTarget('input');
    } else {
      useTerminalStore.getState().setKeyboardTarget('terminal');
      focusTimer = setTimeout(() => {
        term.focus();
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

    // ── PTY 输出 → 管线（先注册，防止 spawn 瞬间的 OSC 133 标记丢失） ──

    pendingUnlisteners.push(
      onPtyOutput((id, events) => {
        if (disposed) return;
        if (isTerminalDebugEnabled()) {
          terminalDebug('pty-output', { id, events: events.length, kinds: events.map((event) => event.kind) });
        }
        if (sessionId === null) {
          // 尚未拿到 sessionId：先缓冲，等 spawn 完成后回放
          preSession.push({ id, events });
          return;
        }
        if (id === sessionId) {
          controller.handleEvents(events);
        }
      }),
    );

    pendingUnlisteners.push(
      onPtyExit((id) => {
        if (disposed) return;
        if (isTerminalDebugEnabled()) terminalDebug('pty-exit', { id, sessionId });
        if (id === sessionId) term.write('\r\n\x1b[31m[进程已退出]\x1b[0m\r\n');
      }),
    );

    // ── PTY 启动 ──

    // 类型/cwd 已在 controller 创建前取好（spec）
    const tabCwd = spec?.cwd;
    const spawnOpts = spec?.kind === 'ssh'
      ? { ssh: { host: spec.ssh?.host ?? '', user: spec.ssh?.user, port: spec.ssh?.port }, openMode }
      : spec?.kind === 'local'
        ? { shell: spec.shellType, openMode }
        : undefined;
    // 分屏 pane 初次挂载时容器可能尚未布局，fit 会算出 0×0；用兜底尺寸先启动，
    // 等 ResizeObserver/就绪后重校到真实尺寸，避免 PTY 以 0×0 启动导致空白。
    const spawnCols = term.cols > 0 ? term.cols : 80;
    const spawnRows = term.rows > 0 ? term.rows : 24;
    if (isTerminalDebugEnabled()) {
      terminalDebug('pty-spawn-request', { paneId, tabId, cols: spawnCols, rows: spawnRows, spawnOpts });
    }
    ptySpawn(spawnCols, spawnRows, tabCwd, spawnOpts)
      .then((id) => {
        if (disposed) {
          ptyClose(id).catch(() => {});
          return;
        }
        sessionId = id;
        if (isTerminalDebugEnabled()) terminalDebug('pty-spawn-ready', { paneId, id });
        // 回放 spawn 完成前缓冲的初始输出（shell 启动提示符）
        for (const ev of preSession) {
          if (ev.id === sessionId) {
            controller.handleEvents(ev.events);
          }
        }
        preSession = [];
        onReadyRef.current(id);
        // PTY 就绪后按真实布局尺寸重校
        requestAnimationFrame(() => {
          if (disposed || el.offsetWidth === 0 || el.offsetHeight === 0) return;
          fit.fit();
          useTerminalStore.getState().setDims(paneId, term.cols, term.rows);
          ptyResize(id, term.cols, term.rows).catch(() => {});
          controller.resize(term.cols, term.rows);
        });
      })
      .catch((e) => {
        if (!disposed) {
          if (isTerminalDebugEnabled()) {
            terminalDebug('pty-spawn-error', { paneId, errorType: e instanceof Error ? e.name : typeof e });
          }
          console.error('[useTerminalSession] PTY spawn failed:', e);
          term.write(`\r\n\x1b[31m[无法启动 Shell: ${e}]\x1b[0m\r\n`);
        }
      });

    // ── 用户输入（xterm 聚焦时：classic/altScreen，及 blockList 运行中块） ──

    // blockList 下 End 保留给「回到输入栏」（InputEditor 的全局监听会接住），
    // 不能漏进 PTY（xterm 默认会发 \x1b[F）
    term.attachCustomKeyEventHandler((e) => {
      if (e.type === 'keydown' && e.key === 'End') {
        const scene = useTerminalStore.getState().scenes[tabId] ?? 'classic';
        if (scene === 'blockList') return false;
      }
      return true;
    });

    // ── Alt buffer 滚轮降级：滚轮 → 方向键 ──
    // alt buffer 无 scrollback，xterm 内置滚轮处理在其中是 no-op（TUI 里滚轮「没反应」）。
    // 应用未开鼠标上报时把滚轮按行折算成 ↑/↓ 发给 PTY（iTerm2 同款降级）；
    // 开了鼠标上报（vim mouse=a、htop 等）则放行，由 xterm 默认逻辑转发鼠标事件。
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

    const dataSub = term.onData((data) => {
      if (sessionId) {
        const inputScene = currentScene;
        if (isTerminalDebugEnabled()) {
          terminalDebug('terminal-input', {
            paneId,
            sessionId,
            scene: inputScene,
            buffer: term.buffer.active.type,
            chars: data.length,
          });
        }
        ptyWrite(sessionId, data).then(() => {
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

    // ── 选中即复制 ──

    const selectionSub = term.onSelectionChange(() => {
      const sel = term.getSelection();
      if (sel) navigator.clipboard.writeText(sel).catch(() => {});
    });

    // ── Resize ──
    // Classic and alternate-screen scenes use the main xterm width. In block-list
    // mode, match the PTY to the visible output width so wrapped lines stay intact.

    /** 实测字符宽（渲染服务内部尺寸，与 RunningTerm 的 cellHeight 同源） */
    const cellWidth = (): number => getCellMetrics(term).width;

    /** 实测行高（渲染服务内部尺寸，与 RunningTerm 的 cellHeight 同源） */
    const cellHeight = (): number => getCellMetrics(term).height;

    /**
     * Return the manual fullscreen host size, or null when it is inactive.
     */
    const fullscreenHostSize = (): { w: number; h: number } | null => {
      const fsHost = document.querySelector<HTMLElement>('[data-testid="tui-fullscreen"]');
      if (!fsHost) return null;
      const padTop = parseFloat(fsHost.style.paddingTop) || 0;
      return { w: fsHost.clientWidth, h: fsHost.clientHeight - padTop };
    };

    /**
     * Measure DOM glyph width because completed HTML snapshots use browser font
     * metrics while live xterm uses its internal cell width. Reuse the snapshot
     * font family so command output keeps the same wrapping before and after exit.
     */
    let cachedDomCellWidth = 0;
    const domCellWidth = (): number => {
      if (cachedDomCellWidth > 0) return cachedDomCellWidth;
      const probe = document.createElement('span');
      probe.style.cssText =
        'position:absolute;left:-9999px;top:0;visibility:hidden;white-space:pre;line-height:1;';
      probe.style.fontFamily = TERMINAL_FONT_FAMILY;
      probe.style.fontSize = `${getTerminalFontSize()}px`;
      probe.textContent = 'W'.repeat(100);
      document.body.appendChild(probe);
      const w = probe.getBoundingClientRect().width / 100;
      probe.remove();
      cachedDomCellWidth = w > 0 ? w : 0;
      return cachedDomCellWidth || cellWidth();
    };

    /** 当前场景下 PTY/块终端应有的列数 */
    const effectiveCols = (): number => {
      // Manual fullscreen changes the store scene without changing the controller scene.
      // Read the store value here to keep sizing on the fullscreen branch.
      const scene = useTerminalStore.getState().scenes[paneId] ?? currentScene;
      // Measure the manual fullscreen host with xterm's cell width so the canvas fills it.
      if (scene === 'altScreen') {
        const fs = fullscreenHostSize();
        if (fs && fs.w > 0) return Math.max(2, Math.floor(fs.w / cellWidth()));
        return term.cols;
      }
      if (scene !== 'blockList') return term.cols;
      // Measure a mounted output host to account for its padding and scrollbars.
      // Before it mounts, estimate the content width from the main terminal container.
      const pane = document.querySelector<HTMLElement>(`[data-testid="pane-${paneId}"]`);
      const host = pane?.querySelector<HTMLElement>('[data-testid="running-term"]');
      const screenPx = host
        ? host.clientWidth - 16
        : el.offsetWidth - BLOCK_CONTENT_INSET_PX;
      // A hidden or not-yet-laid-out host has no measurable width; retry after mount.
      if (screenPx <= 0) return term.cols;
      return Math.max(2, Math.min(term.cols, Math.floor(screenPx / domCellWidth())));
    };

    /** PTY row count for the current scene; manual fullscreen uses the host height. */
    const effectiveRows = (): number => {
      const scene = useTerminalStore.getState().scenes[paneId] ?? currentScene;
      if (scene === 'altScreen') {
        const fs = fullscreenHostSize();
        if (fs && fs.h > 0) return Math.max(1, Math.floor(fs.h / cellHeight()));
      }
      return term.rows;
    };

    let widthRaf = 0;
    const applyWidth = () => {
      if (widthRaf) return;
      widthRaf = requestAnimationFrame(() => {
        widthRaf = 0;
        // 后台标签 display:none 宽度为 0，别把 PTY 挤成 2 列
        if (el.offsetWidth === 0) return;
        const scene = useTerminalStore.getState().scenes[paneId] ?? currentScene;
        if (scene === 'altScreen') {
          // 全屏是纯 xterm 画布：让 fit 使用渲染器实测尺寸，避免字体回退后的
          // 私有 cellWidth 与 canvas 实际 cell 不一致。
          fit.fit();
          useTerminalStore.getState().setDims(paneId, term.cols, term.rows);
          if (sessionId) ptyResize(sessionId, term.cols, term.rows).catch(() => {});
          controller.resize(term.cols, term.rows);
          return;
        }
        const cols = effectiveCols();
        const rows = effectiveRows();
        if (cols <= 0 || rows <= 0) return;
        if (sessionId) ptyResize(sessionId, cols, rows).catch(() => {});
        controller.resize(cols, rows);
      });
    };
    widthSyncs.set(paneId, applyWidth);
    const unsubscribeTypography = useTypographyStore.subscribe((state, previous) => {
      if (state.terminalFontSize === previous.terminalFontSize) return;
      term.options.fontSize = state.terminalFontSize;
      cachedDomCellWidth = 0;
      if (el.offsetWidth > 0 && el.offsetHeight > 0) {
        fit.fit();
        useTerminalStore.getState().setDims(paneId, term.cols, term.rows);
        applyWidth();
      }
    });

    let resizeRaf = 0;
    const ro = new ResizeObserver(() => {
      if (resizeRaf) return;
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = 0;
        // 元素隐藏（display:none，如 blockList 场景/后台标签）时尺寸为 0，
        // fit() 会算出 9×5 之类的虚假尺寸并污染 PTY 与离屏 outputTerm —— 跳过。
        if (el.offsetWidth === 0 || el.offsetHeight === 0) return;
        fit.fit();
        useTerminalStore.getState().setDims(paneId, term.cols, term.rows);
        applyWidth();
      });
    });
    ro.observe(el);

    // ── 清理 ──

    return () => {
      unsubscribeTypography();
      disposed = true;
      if (isTerminalDebugEnabled()) {
        terminalDebug('session-controller-dispose', { paneId, tabId, hasSession: Boolean(sessionId) });
      }
      if (focusTimer) {
        clearTimeout(focusTimer);
        focusTimer = null;
      }
      selectionSub.dispose();
      dataSub.dispose();
      cancelAnimationFrame(resizeRaf);
      cancelAnimationFrame(widthRaf);
      ro.disconnect();
      if (widthSyncs.get(paneId) === applyWidth) widthSyncs.delete(paneId);
      if (sessionControllers.get(paneId) === controller) sessionControllers.delete(paneId);
      controller.dispose();
      unlisteners.forEach((u) => u());
      pendingUnlisteners.forEach((p) => p.then((u) => u()).catch(() => {}));
      if (sessionId) ptyClose(sessionId).catch(() => {});
      unregisterTerminal(paneId, term);
      term.dispose();
    };
  }, [paneId, tabId]);

  return containerRef;
}
