/**
 * useTerminalSession — 主 xterm 生命周期 + SessionController 接线。
 *
 * 主 xterm 只在 classic / altScreen 场景接收数据（blockList 下闲置隐藏）。
 */

import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { ptySpawn, ptyWrite, ptyResize, ptyClose, onPtyOutput, onPtyExit } from '../lib/pty';
import { registerTerminal, unregisterTerminal, useTerminalStore } from '../stores/terminal';
import { useBlockStore } from '../stores/blocks';
import { useHistoryStore } from '../stores/history';
import { useWorkspaceStore } from '../stores/workspace';
import { leaves as layoutLeaves } from '../lib/windowLayout';
import * as sessionManager from '../lib/sessionManager';
import { SessionController } from './pipeline/sessionController';
import type { TermBlock } from './pipeline/termBlock';
import type { UnlistenFn } from '@tauri-apps/api/event';

/**
 * TermBlock UI 投影：剥离 controller 内部字段（outputTerm/earlyBuf 等）。
 * bookmarked 只活在 store（controller 不读回），整体替换数组时按 id 保留，
 * 否则下一次 onBlocksChanged 会把用户的书签冲掉。
 */
function projectBlock(b: TermBlock, bookmarked: boolean, collapsed: boolean): TermBlock {
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
    bookmarked: bookmarked || undefined,
    collapsed: collapsed || undefined,
    outputHtml: b.outputHtml,
    outputText: b.outputText,
    outputRaw: b.outputRaw,
    linesTruncated: b.linesTruncated,
  };
}

/** tabId → SessionController 注册表：供命令层反向触达（「清除输出块」必须经 controller，
 *  它是真相源，只清 store 会被下一次 onBlocksChanged 整体回填） */
const sessionControllers = new Map<string, SessionController>();

/** 清除指定 tab 的全部输出块；无存活 session 时退化为清 store。 */
export function clearSessionBlocks(tabId: string): void {
  const c = sessionControllers.get(tabId);
  if (c) c.clear();
  else useBlockStore.getState().clearBlocks(tabId);
}

/** 运行中块的活终端（RunningItem 挂载显示 / useTerminalFocus 聚焦目标） */
export function getExecutingTerm(tabId: string) {
  return sessionControllers.get(tabId)?.executingTerm ?? null;
}

/** tabId → 场景感知 resize 驱动（blockList 下 PTY/块终端宽度跟随卡片内容宽）。
 *  RunningTerm 的宿主尺寸变化（卡片出现、滚动条挤占）时回调进来 */
const widthSyncs = new Map<string, () => void>();

/** 触发指定 tab 重新校核 PTY/块终端宽度（无 session 时 no-op） */
export function syncTermWidth(tabId: string): void {
  widthSyncs.get(tabId)?.();
}

/** blockList 场景下卡片屏幕宽度 = 容器宽 − 50px：
 *  卡片 margin 8×2 + border 1×2（RunningItem）+ 宿主 padding 8×2（RunningTerm）
 *  + 块内 .xterm padding 8×2（theme.css running-term 覆写）。
 *  与 CSS 耦合，改卡片几何需同步此常量；有运行中宿主时优先实测而非用常量 */
const CARD_CHROME_PX = 50;

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

    const cs = getComputedStyle(document.documentElement);
    const term = new Terminal({
      fontFamily:
        'Menlo, Monaco, "Cascadia Code", "JetBrains Mono", "Noto Sans CJK SC", "PingFang SC", "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", monospace',
      fontSize: 14,
      cursorBlink: true,
      scrollback: 5000,
      allowTransparency: false,
      theme: {
        background: cs.getPropertyValue('--xterm-bg').trim() || '#050505',
        cursor: cs.getPropertyValue('--xterm-cursor').trim() || '#e8e8e8',
        selectionBackground: cs.getPropertyValue('--xterm-selection').trim() || 'rgba(255,255,255,0.25)',
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(el);
    fit.fit();
    registerTerminal(paneId, term);
    useTerminalStore.getState().setDims(paneId, term.cols, term.rows);

    let sessionId: string | null = null;
    let disposed = false;
    const unlisteners: UnlistenFn[] = [];
    const pendingUnlisteners: Promise<UnlistenFn>[] = [];
    let focusTimer: ReturnType<typeof setTimeout> | null = null;

    // ── 管线：controller（扫描已在 Rust 端完成，这里直接消费事件） ──

    // 场景本地镜像（onSceneChanged 同步）：决定 resize 用全宽还是卡片宽
    let currentScene: 'classic' | 'blockList' | 'altScreen' = 'classic';
    const controller = new SessionController(paneId, term.cols, {      writeMain: (data) => term.write(data),
      getBookmarkedIds: () =>
        new Set((useBlockStore.getState().byTab[paneId] ?? []).filter((b) => b.bookmarked).map((b) => b.id)),
      onBlocksChanged: () => {
        const prev = useBlockStore.getState().byTab[paneId] ?? [];
        const bookmarkedIds = new Set(prev.filter((b) => b.bookmarked).map((b) => b.id));
        const collapsedIds = new Set(prev.filter((b) => b.collapsed).map((b) => b.id));
        useBlockStore.getState().setBlocks(
          paneId,
          controller.blocks.map((b) => projectBlock(b, bookmarkedIds.has(b.id), collapsedIds.has(b.id))),
        );
      },
      onSceneChanged: (scene) => {
        currentScene = scene;
        useTerminalStore.getState().setScene(paneId, scene);
        if (useWorkspaceStore.getState().activeId !== tabId) return;
        // 注意：真实 altScreen（1049h）不得触碰 altScreenActive ——
        // 该 flag 仅表示「用户手动全屏块终端」（TerminalBlockList 进入全屏交互），
        // 误设会让 TerminalView 判定 manualTui，把持有 TUI 输出的主 xterm 用
        // opacity:0 藏掉，用户看到冻结画面且键盘如无响应。
        if (scene === 'blockList') {
          term.reset(); // 清掉 classic 残留
          useTerminalStore.getState().setKeyboardTarget('input');
        } else {
          useTerminalStore.getState().setKeyboardTarget('terminal');
          focusTimer = setTimeout(() => term.focus(), 50);
        }
        // 场景切换改变有效宽度（blockList=卡片宽，其余=全宽），重新校核
        applyWidth();
      },
      onCwd: (path) => {
        useWorkspaceStore.getState().setTerminalCwd(paneId, path);
      },
      onBlockStart: (block) => {
        sessionManager.record(tabId, paneId, block, 'start');
        // 惯用命名：标题跟随「聚焦终端」的首条命令（未定名时）
        if (block.command && paneId === useTerminalStore.getState().focusedPaneId) {
          useWorkspaceStore.getState().titleFromCommand(tabId, block.command);
        }
      },
      onBlockComplete: (block) => {
        useHistoryStore.getState().record(block.command, block.cwd ?? '', block.exitCode);
        sessionManager.record(tabId, paneId, block, 'complete');
        // 手动全屏（「进入全屏交互」）的运行块完成时退出全屏，回到块列表
        const ts = useTerminalStore.getState();
        if (ts.scenes[paneId] === 'altScreen') {
          ts.setScene(paneId, 'blockList');
          ts.setAltScreenActive(false);
        }
      },
      // altScreen 退出前（1049l 尚未写主 xterm）取 alt buffer 最终画面，回填 TUI 块
      captureMainScreen: () => {
        const buf = term.buffer.active;
        const lines: string[] = [];
        for (let i = 0; i < buf.length; i++) {
          const line = buf.getLine(i);
          if (line) lines.push(line.translateToString(true));
        }
        while (lines.length > 0 && !lines[lines.length - 1]!.trim()) lines.pop();
        return lines.join('\r\n');
      },
    }, term.rows);
    sessionControllers.set(paneId, controller);

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
        if (id === sessionId) {
          controller.handleEvents(events);
        }
      }),
    );

    pendingUnlisteners.push(
      onPtyExit((id) => {
        if (disposed) return;
        if (id === sessionId) term.write('\r\n\x1b[31m[进程已退出]\x1b[0m\r\n');
      }),
    );

    // ── PTY 启动 ──

    // 从窗口布局里取该终端的类型/cwd（paneId 即终端 id）
    const tab = useWorkspaceStore.getState().tabs.find((t) => t.id === tabId);
    const spec = tab && tab.kind === 'session'
      ? layoutLeaves(tab.layout).find((t) => t.id === paneId)
      : undefined;
    const tabCwd = spec?.cwd;
    const spawnOpts = spec?.kind === 'ssh'
      ? { ssh: { host: spec.ssh?.host ?? '', user: spec.ssh?.user, port: spec.ssh?.port } }
      : spec?.kind === 'local' && spec.shellType
        ? { shell: spec.shellType }
        : undefined;
    // 分屏 pane 初次挂载时容器可能尚未布局，fit 会算出 0×0；用兜底尺寸先启动，
    // 等 ResizeObserver/就绪后重校到真实尺寸，避免 PTY 以 0×0 启动导致空白。
    const spawnCols = term.cols > 0 ? term.cols : 80;
    const spawnRows = term.rows > 0 ? term.rows : 24;
    ptySpawn(spawnCols, spawnRows, tabCwd, spawnOpts)
      .then((id) => {
        if (disposed) {
          ptyClose(id).catch(() => {});
          return;
        }
        sessionId = id;
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
      const linePx = Math.max(1, (term.options.fontSize ?? 13) * 1.4);
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
      if (sessionId) ptyWrite(sessionId, data).catch(() => {});
    });

    // ── 选中即复制 ──

    const selectionSub = term.onSelectionChange(() => {
      const sel = term.getSelection();
      if (sel) navigator.clipboard.writeText(sel).catch(() => {});
    });

    // ── Resize ──
    // 场景感知宽度：classic/altScreen 用主 xterm 全宽；blockList 下 PTY 与块终端
    // 跟随卡片内容宽（卡片比主表面窄 ~50px，满宽输出会在卡片右缘被裁 ——
    // 「输出宽度与可显示宽度不一致导致部分边缘看不到」）。
    // 主 xterm 本体始终保持全宽（隐藏时 opacity:0 仍有真实尺寸），
    // 回到 classic/altScreen 直接恢复。

    /** 实测字符宽（渲染服务内部尺寸，与 RunningTerm 的 cellHeight 同源） */
    const cellWidth = (): number => {
      const dims = (term as unknown as {
        _core?: { _renderService?: { dimensions?: { css?: { cell?: { width?: number } } } } };
      })._core?._renderService?.dimensions;
      return dims?.css?.cell?.width || 7.8;
    };

    /** 当前场景下 PTY/块终端应有的列数 */
    const effectiveCols = (): number => {
      // 以 store 场景为准：手动全屏（「进入全屏交互」）只写 store.scene，不回调
      // onSceneChanged，currentScene 本地镜像仍停在 blockList；若只看它会误走
      // 卡片宽分支、把折叠宿主宽读成 0 → PTY 挤成 2 列（全屏 TUI「宽度极其小」）。
      const scene = useTerminalStore.getState().scenes[paneId] ?? currentScene;
      if (scene !== 'blockList') return term.cols;
      // 有运行中卡片宿主时实测（自动覆盖滚动条挤占等偏差）；
      // 否则用容器宽 − 卡片常量。宿主 clientWidth 含 .xterm 左右各 8px padding。
      const host = document.querySelector<HTMLElement>('[data-testid="running-term"]');
      const screenPx = host
        ? host.clientWidth - 16
        : el.offsetWidth - CARD_CHROME_PX;
      // 宿主折叠（display:none / 布局过渡中 clientWidth≈0）→ screenPx≤0，
      // 退回主 xterm 全宽，等宿主落位后 ResizeObserver 再按真实卡片宽校正。
      if (screenPx <= 0) return term.cols;
      return Math.max(2, Math.min(term.cols, Math.floor(screenPx / cellWidth())));
    };

    let widthRaf = 0;
    const applyWidth = () => {
      if (widthRaf) return;
      widthRaf = requestAnimationFrame(() => {
        widthRaf = 0;
        // 后台标签 display:none 宽度为 0，别把 PTY 挤成 2 列
        if (el.offsetWidth === 0) return;
        const cols = effectiveCols();
        const rows = term.rows;
        if (cols <= 0 || rows <= 0) return;
        if (sessionId) ptyResize(sessionId, cols, rows).catch(() => {});
        controller.resize(cols, rows);
      });
    };
    widthSyncs.set(paneId, applyWidth);

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
      disposed = true;
      if (focusTimer) {
        clearTimeout(focusTimer);
        focusTimer = null;
      }
      selectionSub.dispose();
      dataSub.dispose();
      cancelAnimationFrame(resizeRaf);
      cancelAnimationFrame(widthRaf);
      ro.disconnect();
      widthSyncs.delete(paneId);
      sessionControllers.delete(paneId);
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
