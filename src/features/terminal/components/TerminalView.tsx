/**
 * TerminalView — 终端主表面（窗口 = 会话容器，持有 1–4 个终端的二叉分裂树）。
 *
 *   渲染活跃窗口的布局树：
 *     - leaf → 终端 pane（隐藏 xterm 驱动 PTY + 块列表 + 独立输入栏 + 类型下拉）
 *     - split → 行/列 flex + 可拖拽分隔线（调宽/高）
 *   分裂用 ⌘D/⌘⇧D（继承类型）、⌥⌘D（选类型）；分隔线拖动调整比例。
 */

import { useRef, useEffect, useMemo, useState } from 'react';
import { useSessionStore, type Tab } from '@features/workspace';
import { useTerminalStore } from '@features/terminal';
import { useUiStore, useDockDragStore } from '@features/workspace';
import { useBlockStore, selectBlocks } from '@features/terminal';
import { usePaneMessages } from '@features/chat';
import { useChatPanelOpen } from '@features/workspace';
import { useToastStore } from '@ui/Toast';
import { useFollowBottom, registerFollowEngager, engageFollow } from '@features/terminal/hooks/useFollowBottom';
import { useTerminalFocus } from '@features/terminal/hooks/useTerminalFocus';
import { useTerminalPaneDrag } from '@features/terminal/hooks/useTerminalPaneDrag';
import {
  leaves as layoutLeaves, firstLeaf, moveTargets, dividers, collectLayoutCells, MIN_PANE_SIZE, DIVIDER_SIZE,
  type WindowLayout, type TerminalSpec, type DropTarget, type Rect,
} from '@features/workspace/model/windowLayout';
import InputEditor from '@features/terminal/components/InputEditor';
import AiStatusBar from '@features/terminal/components/AiStatusBar';
import TerminalBlockList, { hasVisibleContent } from '@features/terminal/components/TerminalBlockList';
import TerminalPanel from '@features/terminal/components/TerminalPanel';
import { SessionHistoryView } from '@features/session-history';
import SettingsView from '@features/settings/pages/SettingsView';
import ContextMenu from '@ui/ContextMenu';
import { useTerminalLayoutActions } from '@features/terminal/hooks/useTerminalLayoutActions';
import { useTuiControls } from '@features/terminal/hooks/useTuiControls';

export default function TerminalView() {
  const tabs = useSessionStore((s) => s.tabs);
  const activeId = useSessionStore((s) => s.activeId);
  const setSession = useTerminalStore((s) => s.setSession);
  const setFocusedPane = useTerminalStore((s) => s.setFocusedPane);
  const focusedPaneId = useTerminalStore((s) => s.focusedPaneId);
  const sessions = useTerminalStore((s) => s.sessions);
  const altScreenActive = useTerminalStore((s) => s.altScreenActive);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);

  const activeTab = tabs.find((t) => t.id === activeId);
  const isSession = activeTab?.kind === 'session';

  const focusedTermId = isSession
    ? (focusedPaneId && sessions[focusedPaneId] && layoutLeaves(activeTab!.layout).some((t) => t.id === focusedPaneId)
        ? focusedPaneId
        : firstLeaf(activeTab!.layout).id)
    : activeId;

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
      {!activeTab && <SessionHistoryView />}
      {/* 所有 session tab 保持挂载，非活跃 tab 隐藏而非卸载 ——
          卸载会触发 useTerminalSession cleanup 里的 ptyClose，杀掉运行中的命令。
          切走再切回时 PTY/块列表/离屏终端全部存活。 */}
      {tabs.map((tab) => {
        if (tab.kind === 'session') {
          return (
            <SessionTabView
              key={tab.id}
              tab={tab}
              active={tab.id === activeId}
              setSession={setSession}
              setFocusedPane={setFocusedPane}
              onPaneContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY }); }}
            />
          );
        }
        if (tab.id !== activeId) return null; // history/settings 无 PTY，无需保活
        return tab.kind === 'history' ? <SessionHistoryView key={tab.id} /> : <SettingsView key={tab.id} />;
      })}

      {/* Manual fullscreen host for a running block, with room for the toolbar. */}
      {altScreenActive && (
        <div data-testid="tui-fullscreen" style={{ position: 'absolute', inset: 0, zIndex: 100, background: 'var(--xterm-bg)', paddingTop: 28 }} />
      )}

      {/* 终端区域右键菜单 */}
      {ctxMenu && (
        <ContextMenu
          anchor={ctxMenu}
          onClose={() => setCtxMenu(null)}
          items={[
            { label: '分裂终端（选位置）', onClick: () => useUiStore.getState().beginSplit(null) },
            { label: '选择类型分裂', onClick: () => useUiStore.getState().openSplitPicker() },
            { label: '更换位置', onClick: () => useUiStore.getState().beginMove(focusedTermId) },
        { label: '关闭终端', danger: true, onClick: () => useSessionStore.getState().closeFocusedTerminal() },
          ]}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// 单个 session tab 表面（含布局树 + 分裂/移动覆盖层）
// ═══════════════════════════════════════════════════════════

function SessionTabView(props: {
  tab: Extract<Tab, { kind: 'session' }>;
  active: boolean;
  setSession: (id: string, sid: string) => void;
  setFocusedPane: (id: string) => void;
  onPaneContextMenu: (e: React.MouseEvent) => void;
}) {
  const { tab, active, setSession, setFocusedPane, onPaneContextMenu } = props;
  const windowId = tab.id;
  const layout = tab.layout;
  const focusedPaneId = useTerminalStore((s) => s.focusedPaneId);
  const sessions = useTerminalStore((s) => s.sessions);
  const draggingId = useDockDragStore((s) => s.draggingTerminalId);

  const focusedTermId = focusedPaneId && sessions[focusedPaneId] && layoutLeaves(layout).some((t) => t.id === focusedPaneId)
    ? focusedPaneId
    : firstLeaf(layout).id;

  const scene = useTerminalStore((s) => s.scenes[focusedTermId] ?? 'classic');
  const focusBlocks = useBlockStore(selectBlocks(focusedTermId));
  const hasExecutingBlock = focusBlocks.some((b) => b.status === 'executing');
  useTerminalFocus(active && scene === 'blockList' && hasExecutingBlock, focusedTermId);

  const {
    splitPlacement,
    cancelSplit,
    movePlacement,
    cancelMove,
    placementTargets,
    movePlacementTargets,
    commitPlacement,
    commitMove,
    completeMove,
    setRatioNode,
  } = useTerminalLayoutActions({ windowId, layout });

  return (
    <div style={{
      position: 'absolute', inset: 0,
      display: active ? 'flex' : 'none',
      flexDirection: 'column',
      background: 'var(--xterm-bg)',
    }}>
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', position: 'relative' }}>
        {/* 平面渲染：pane 按终端 id 作 key，绝对定位落位 ——
            拖动重排只改几何，不重挂 TerminalPane（重挂会 ptyClose 杀掉运行中命令）。 */}
        <PaneLayout
          layout={layout}
          windowId={windowId}
          focusedTermId={focusedTermId}
          setSession={setSession}
          setFocusedPane={setFocusedPane}
          setRatioNode={setRatioNode}
          onPaneContextMenu={onPaneContextMenu}
        />

        {/* 分裂落点选择覆盖层（相对布局区域定位，忠实反映未来区域） */}
        {active && splitPlacement.open && (
          <PlacementOverlay targets={placementTargets} onPick={commitPlacement} onCancel={cancelSplit} />
        )}

        {/* 更换位置落点选择覆盖层（菜单触发，等同拖动重排） */}
        {active && movePlacement.open && (
          <PlacementOverlay
            targets={movePlacementTargets}
            emptyMessage="只有一个终端，无法更换位置"
            onPick={completeMove}
            onCancel={cancelMove}
          />
        )}

        {/* 拖动终端调整位置的落点覆盖层 */}
        {active && draggingId && (
          <MoveDragLayer layout={layout} draggingId={draggingId} onCommit={commitMove} />
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// 布局平面渲染（PaneLayout）
// ═══════════════════════════════════════════════════════════

interface InnerEdges { left: boolean; right: boolean; top: boolean; bottom: boolean; }

/**
 * PaneLayout — 窗口布局的平面渲染。
 *
 * 所有 pane 按终端 id 作 key 一次性绝对定位（百分比几何），而非递归 flex 嵌套。
 * 拖动终端重排（removeLeaf + splitLeaf）会重构布局树；若用递归渲染，React 按
 * 位置对账会让 TerminalPane 被复用/重挂，触发 useTerminalSession cleanup 的
 * ptyClose —— 运行中命令立刻被杀。平面渲染下实例身份 = 终端 id，移动只改样式。
 */
function PaneLayout(props: {
  layout: WindowLayout;
  windowId: string;
  focusedTermId: string;
  setSession: (id: string, sid: string) => void;
  setFocusedPane: (id: string) => void;
  setRatioNode: (aId: string, bId: string, ratio: number) => void;
  onPaneContextMenu: (e: React.MouseEvent) => void;
}) {
  const { layout, windowId, focusedTermId, setSession, setFocusedPane, setRatioNode, onPaneContextMenu } = props;
  const cells = useMemo(() => {
    const collected = collectLayoutCells(layout);
    const rects = new Map(collected.map((c) => [c.terminalId, c.rect]));
    const inners = new Map(collected.map((c) => [c.terminalId, c.inner]));
    return layoutLeaves(layout).map((t) => ({
      terminal: t,
      rect: rects.get(t.id)!,
      inner: inners.get(t.id)!,
    }));
  }, [layout]);
  const divs = useMemo(() => dividers(layout), [layout]);

  return (
    <div style={{ position: 'relative', flex: 1, minWidth: 0, minHeight: 0 }}>
      {cells.map((cell) => (
        <div
          key={cell.terminal.id}
          style={{
            position: 'absolute',
            left: `${cell.rect.x * 100}%`, top: `${cell.rect.y * 100}%`,
            width: `${cell.rect.w * 100}%`, height: `${cell.rect.h * 100}%`,
            display: 'flex', minWidth: 0, minHeight: 0,
          }}
        >
          <TerminalPane
            terminal={cell.terminal}
            windowId={windowId}
            focused={cell.terminal.id === focusedTermId}
            setSession={setSession}
            setFocusedPane={setFocusedPane}
            onContextMenu={onPaneContextMenu}
            inner={cell.inner}
            reorderable={cells.length > 1}
          />
        </div>
      ))}
      {divs.map((d) => (
        <Divider key={`${d.aId}-${d.bId}`} dir={d.dir} rect={d.rect} region={d.region} onRatio={(r) => setRatioNode(d.aId, d.bId, r)} />
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// 分隔线（拖拽调比例）
// ═══════════════════════════════════════════════════════════

function Divider({ dir, rect, region, onRatio }: { dir: 'row' | 'col'; rect: Rect; region: Rect; onRatio: (r: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const isRow = dir === 'row';

  const onDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const container = ref.current?.parentElement;
    if (!container) return;
    const cRect = container.getBoundingClientRect();
    // 嵌套分隔线以自身 split 区域（region）为准换算比例，而非整个布局区
    const regionLeft = cRect.left + region.x * cRect.width;
    const regionTop = cRect.top + region.y * cRect.height;
    const regionW = region.w * cRect.width;
    const regionH = region.h * cRect.height;
    const move = (ev: MouseEvent) => {
      const size = isRow ? regionW : regionH;
      const pos = isRow ? (ev.clientX - regionLeft) : (ev.clientY - regionTop);
      // 像素级最小尺寸：每侧至少 MIN_PANE_SIZE，避免拖到「覆盖」内容
      const minRatio = Math.min(0.5, MIN_PANE_SIZE / size);
      const maxRatio = Math.max(0.5, 1 - MIN_PANE_SIZE / size);
      const r = Math.max(minRatio, Math.min(maxRatio, pos / size));
      onRatio(r);
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  };

  const style: React.CSSProperties = {
    position: 'absolute',
    zIndex: 5,
    cursor: isRow ? 'col-resize' : 'row-resize',
    transition: 'background 0.12s ease',
  };
  if (isRow) {
    style.left = `${rect.x * 100}%`;
    style.top = `${rect.y * 100}%`;
    style.width = DIVIDER_SIZE;
    style.height = `${rect.h * 100}%`;
    style.transform = 'translateX(-50%)';
  } else {
    style.left = `${rect.x * 100}%`;
    style.top = `${rect.y * 100}%`;
    style.width = `${rect.w * 100}%`;
    style.height = DIVIDER_SIZE;
    style.transform = 'translateY(-50%)';
  }

  return (
    <div
      ref={ref}
      onMouseDown={onDown}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent-bg)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      style={style}
    />
  );
}

// ═══════════════════════════════════════════════════════════
// 终端 pane
// ═══════════════════════════════════════════════════════════

function TerminalPane(props: {
  terminal: TerminalSpec;
  windowId: string;
  focused: boolean;
  setSession: (id: string, sid: string) => void;
  setFocusedPane: (id: string) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  inner: InnerEdges;
  reorderable: boolean;
}) {
  const { terminal, windowId, focused, setSession, setFocusedPane, onContextMenu, inner, reorderable } = props;
  const scene = useTerminalStore((s) => s.scenes[terminal.id] ?? 'classic');
  const altScreenActive = useTerminalStore((s) => s.altScreenActive);
  // Real alternate buffers use the main xterm; manual fullscreen uses the live block terminal.
  const showXterm = scene === 'classic' || (scene === 'altScreen' && !altScreenActive);
  const showBlocks = scene === 'blockList';

  const onPaneMouseDown = useTerminalPaneDrag(terminal.id, reorderable);

  return (
    <div
      data-testid={`pane-${terminal.id}`}
      className="terminal-pane"
      data-focused={focused ? 'true' : 'false'}
      onClick={() => setFocusedPane(terminal.id)}
      onMouseDown={onPaneMouseDown}
      onContextMenu={(e) => { setFocusedPane(terminal.id); onContextMenu(e); }}
      style={{
        flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column',
        position: 'relative',
        // Match terminal output, pane padding and block history to the classic background.
        background: 'var(--xterm-bg)',
        // 只在「面向其它终端」的边上画线，外缘不画 —— 避免与侧栏的 1px 边框叠加成重线
        borderTop: inner.top ? `1px solid ${focused ? 'var(--border-strong)' : 'var(--border)'}` : 'none',
        borderBottom: inner.bottom ? `1px solid ${focused ? 'var(--border-strong)' : 'var(--border)'}` : 'none',
        borderLeft: inner.left ? `1px solid ${focused ? 'var(--border-strong)' : 'var(--border)'}` : 'none',
        borderRight: inner.right ? `1px solid ${focused ? 'var(--border-strong)' : 'var(--border)'}` : 'none',
        overflow: 'hidden',
      }}
    >
      {/* Keep xterm mounted; hide it only while the block terminal is manually fullscreened. */}
      {/* AI 状态栏（仅 AI 模式显示，置于页面顶部） */}
      <AiStatusBar paneId={terminal.id} />
      <div style={showXterm
        // Keep the native terminal scrollbar flush with the pane's right edge.
        // 左边距不在这里加：它只属于终端屏幕内容（见 TerminalPanel），
        // 否则认证输入条等整宽元素会被一起推右，出现左右不对称。
        ? { flex: 1, minHeight: 0, position: 'relative', padding: '8px 0 0 0', paddingTop: scene === 'altScreen' ? 28 : 8, background: 'transparent' }
        : { position: 'absolute', inset: 0, opacity: 0, pointerEvents: 'none' }}>
        <TerminalPanel paneId={terminal.id} tabId={windowId} connectionInput={terminal.kind === 'ssh'} onReady={(sid) => setSession(terminal.id, sid)} />
      </div>

      {/* Keep the block list mounted so its live terminal survives manual fullscreen. */}
      <div style={{ display: showBlocks ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'column' }}>
        <PaneBlockList paneId={terminal.id} insetLeft={inner.left ? 4 : 8} insetRight={inner.right ? 4 : 8} />
      </div>
      {showBlocks && (
        <PaneInputEditor
          paneId={terminal.id}
          focused={focused}
          insetLeft={inner.left ? 4 : 8}
          insetRight={inner.right ? 4 : 8}
        />
      )}
      {scene === 'altScreen' && <TuiBanner tabId={terminal.id} />}
    </div>
  );
}

/** 根据归一化坐标 (0..1) 挑出光标所在落点：取「深入未来区域最深」者，解决半屏重叠歧义。 */
function pickDropZone(targets: DropTarget[], nx: number, ny: number): number | null {
  let best: number | null = null;
  let bestScore = -Infinity;
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i]!;
    const r = t.rect;
    if (nx < r.x - 1e-6 || nx > r.x + r.w + 1e-6) continue;
    if (ny < r.y - 1e-6 || ny > r.y + r.h + 1e-6) continue;
    const score = t.dir === 'row'
      ? (t.position === 'first' ? (r.x + r.w) - nx : nx - r.x)
      : (t.position === 'first' ? (r.y + r.h) - ny : ny - r.y);
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return best;
}

// ── 分裂落点选择覆盖层 ──

function PlacementOverlay({ targets, onPick, onCancel, emptyMessage = '最多 4 个终端' }: {
  targets: DropTarget[];
  onPick: (t: DropTarget) => void;
  onCancel: () => void;
  emptyMessage?: string;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (targets.length === 0) {
      useToastStore.getState().addToast(emptyMessage, 'info');
      onCancel();
      return;
    }
    // Esc 取消（捕获阶段，优先于全局快捷键）
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [targets.length, emptyMessage, onCancel]);

  const locate = (clientX: number, clientY: number): number | null => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    return pickDropZone(targets, (clientX - rect.left) / rect.width, (clientY - rect.top) / rect.height);
  };

  return (
    <div
      ref={ref}
      onClick={(e) => {
        const idx = locate(e.clientX, e.clientY);
        if (idx != null) onPick(targets[idx]!);
        else onCancel();
      }}
      onMouseMove={(e) => setHovered(locate(e.clientX, e.clientY))}
      onMouseLeave={() => setHovered(null)}
      style={{ position: 'absolute', inset: 0, zIndex: 80, cursor: 'crosshair' }}
    >
      <div data-testid="placement-hint" className="workspace-floating" style={{ position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 1, padding: '8px 12px', fontSize: 'calc(12px * var(--ui-font-scale))', whiteSpace: 'nowrap' }}>
        点击区域选择位置 · Esc 取消
      </div>
      {/* A visible grid explains the placement mode before the pointer moves. */}
      {targets.map((t, i) => (
        <div
          key={i}
          data-testid={`placement-zone-${i}`}
          style={{
            position: 'absolute',
            left: `${t.rect.x * 100}%`, top: `${t.rect.y * 100}%`,
            width: `${t.rect.w * 100}%`, height: `${t.rect.h * 100}%`,
            boxSizing: 'border-box', pointerEvents: 'none',
            background: hovered === i ? 'var(--placement-hover)' : 'var(--placement-bg)',
            border: `1px dashed ${hovered === i ? 'var(--accent)' : 'var(--border-strong)'}`,
            transition: 'background var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease)',
          }}
        >
          <span style={{ position: 'absolute', fontSize: 'calc(12px * var(--ui-font-scale))', color: hovered === i ? 'var(--text-primary)' : 'var(--text-secondary)',
            left: t.dir === 'col' ? '50%' : t.position === 'first' ? 16 : undefined,
            right: t.dir === 'row' && t.position === 'second' ? 16 : undefined,
            top: t.dir === 'row' ? '50%' : t.position === 'first' ? 66 : undefined,
            bottom: t.dir === 'col' && t.position === 'second' ? 20 : undefined,
            transform: t.dir === 'row' ? 'translateY(-50%)' : 'translateX(-50%)',
          }}>{t.dir === 'row' ? (t.position === 'first' ? '左侧' : '右侧') : (t.position === 'first' ? '上方' : '下方')}</span>
        </div>
      ))}
    </div>
  );
}

// ── 拖动终端调整位置的落点覆盖层 ──

function MoveDragLayer({ layout, draggingId, onCommit }: {
  layout: WindowLayout;
  draggingId: string;
  onCommit: (dragId: string, zone: DropTarget) => void;
}) {
  // 可移动落点：对其它每个终端给出上/下/左/右四个边沿落点
  const targets = useMemo(
    () => moveTargets(layout, draggingId),
    [layout, draggingId],
  );
  const [hovered, setHovered] = useState<number | null>(null);
  const hoveredRef = useRef<number | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const rect = overlayRef.current?.getBoundingClientRect();
      let idx: number | null = null;
      if (rect && rect.width > 0 && rect.height > 0) {
        idx = pickDropZone(targets, (e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height);
      }
      hoveredRef.current = idx;
      setHovered(idx);
    };
    const onUp = () => {
      const idx = hoveredRef.current;
      const zone = idx != null ? targets[idx] : undefined;
      if (zone) onCommit(draggingId, zone);
      useDockDragStore.getState().end();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        useDockDragStore.getState().end();
      }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [targets, draggingId, onCommit]);

  if (targets.length === 0) {
    // 单终端没有可移动落点，直接结束
    return null;
  }

  return (
    <div ref={overlayRef} style={{ position: 'absolute', inset: 0, zIndex: 79, cursor: 'grabbing' }}>
      {targets.map((t, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: `${t.rect.x * 100}%`, top: `${t.rect.y * 100}%`,
            width: `${t.rect.w * 100}%`, height: `${t.rect.h * 100}%`,
            boxSizing: 'border-box', pointerEvents: 'none',
            background: hovered === i ? 'rgba(128,128,128,0.18)' : 'transparent',
            transition: 'background var(--dur-fast) var(--ease)',
          }}
        />
      ))}
    </div>
  );
}

// ── TuiBanner（altScreen 应用：vim/htop 等） ──

function TuiBanner({ tabId }: { tabId: string }) {
  const {
    altScreenActive,
    runningCommand,
    killArmed,
    sendCtrlC,
    killApp,
    exitFullScreen,
  } = useTuiControls(tabId);
  return (
    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 101, padding: '3px 12px', fontSize: 'calc(11px * var(--ui-font-scale))', fontFamily: 'var(--font-mono)', background: 'transparent', display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-secondary)' }}>
      <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'var(--accent-warm)', flexShrink: 0 }} />
      <span>TUI{runningCommand ? ` · ${runningCommand}` : ''}</span>
      <div style={{ flex: 1 }} />
      <span onClick={sendCtrlC} title="发送 Ctrl+C" style={{ fontSize: 'calc(10px * var(--ui-font-scale))', padding: '2px 6px', borderRadius: 3, cursor: 'pointer' }}>^C</span>
      <span onClick={killApp} title="结束前台应用 (SIGTERM)" style={{ fontSize: 'calc(10px * var(--ui-font-scale))', padding: '2px 6px', borderRadius: 3, cursor: 'pointer', color: killArmed ? 'var(--accent-warm)' : 'var(--text-secondary)' }}>{killArmed ? '强杀!' : '结束'}</span>
      {altScreenActive && (
        <span onClick={exitFullScreen} title="退出全屏" style={{ fontSize: 'calc(10px * var(--ui-font-scale))', padding: '2px 6px', borderRadius: 3, cursor: 'pointer' }}>esc</span>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// PaneInputEditor（终端 pane 的独立输入栏） ═══════════════════════════════════════════════════════════

function PaneInputEditor({ paneId, focused, insetLeft = 8, insetRight = 8 }: { paneId: string; focused: boolean; insetLeft?: number; insetRight?: number }) {
  const blocks = useBlockStore(selectBlocks(paneId));
  const hasRunningBlock = blocks.some((b) => b.status === 'executing' && b.wasLongRunning);
  const runningCommand = [...blocks].reverse().find((b) => b.status === 'executing')?.command ?? '';
  return (
    <InputEditor
      paneId={paneId}
      focused={focused}
      insetLeft={insetLeft}
      insetRight={insetRight}
      isLongRunning={hasRunningBlock}
      runningCommand={runningCommand}
      onEndPress={() => { engageFollow(paneId); useTerminalStore.getState().setKeyboardTarget('input'); }}
    />
  );
}

// ── PaneBlockList / PaneEmptyHint ──

function PaneBlockList({ paneId, insetLeft = 8, insetRight = 8 }: { paneId: string; insetLeft?: number; insetRight?: number }) {
  const blocks = useBlockStore(selectBlocks(paneId));
  const scrollRef = useRef<HTMLDivElement>(null);
  const snap = useFollowBottom(scrollRef, [blocks], paneId);
  useEffect(() => registerFollowEngager(paneId, snap), [paneId, snap]);
  return (
    <div ref={scrollRef} className="scroll-region" data-testid={`terminal-scroll-${paneId}`} style={{ flex: 1, minHeight: 0, overflowY: 'auto', background: 'var(--xterm-bg)', overflowAnchor: 'none' }}>
      <div data-testid={`terminal-flow-${paneId}`}>
        <TerminalBlockList tabId={paneId} insetLeft={insetLeft} insetRight={insetRight} />
        <PaneEmptyHint paneId={paneId} />
      </div>
    </div>
  );
}

function PaneEmptyHint({ paneId }: { paneId: string }) {
  const blocks = useBlockStore(selectBlocks(paneId));
  const aiMessages = usePaneMessages(paneId);
  const chatPanelOpen = useChatPanelOpen();
  // AI 面板打开时内联不显示，空态提示也不把面板里的对话算作 pane 内容
  if (blocks.some(hasVisibleContent) || (!chatPanelOpen && aiMessages.length > 0)) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', padding: '32px 28px', color: 'var(--text-muted)', fontSize: 'calc(12px * var(--ui-font-scale))', userSelect: 'none', gap: 8 }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'calc(24px * var(--ui-font-scale))', color: 'var(--text-secondary)', fontWeight: 500, marginBottom: 4 }}>$</div>
      <div style={{ color: 'var(--text-primary)', fontSize: 'calc(15px * var(--ui-font-scale))', fontWeight: 500 }}>从一条命令开始</div>
      <div style={{ fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--text-secondary)' }}>在底部输入命令，或打开右上角 AI 助手。</div>
    </div>
  );
}
