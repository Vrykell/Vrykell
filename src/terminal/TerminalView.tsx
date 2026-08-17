/**
 * TerminalView — 终端主表面（窗口 = 会话容器，持有 1–4 个终端的二叉分裂树）。
 *
 *   渲染活跃窗口的布局树：
 *     - leaf → 终端 pane（隐藏 xterm 驱动 PTY + 块列表 + 独立输入栏 + 类型下拉）
 *     - split → 行/列 flex + 可拖拽分隔线（调宽/高）
 *   分裂用 ⌘D/⌘⇧D（继承类型）、⌥⌘D（选类型）；分隔线拖动调整比例。
 */

import { useRef, useEffect, useMemo, useCallback, useState } from 'react';
import { ArrowLeft, ArrowRight, ArrowUp, ArrowDown } from 'lucide-react';
import { useWorkspaceStore, nextTerminalId } from '../stores/workspace';
import { useTerminalStore } from '../stores/terminal';
import { useUiStore } from '../stores/ui';
import { useActiveMessages } from '../stores/chat';
import { useBlockStore, selectBlocks } from '../stores/blocks';
import { ptyWrite } from '../lib/pty';
import { killForeground, ESCALATE_WINDOW_MS } from '../lib/killForeground';
import { useToastStore } from '../components/Toast';
import { useFollowBottom, registerFollowEngager, engageFollow } from './useFollowBottom';
import { useTerminalFocus } from './useTerminalFocus';
import {
  leaves as layoutLeaves, firstLeaf, findLeaf, splitLeaf, dropTargets, setRatio,
  type WindowLayout, type TerminalSpec, type DropTarget,
} from '../lib/windowLayout';
import InputEditor from './InputEditor';
import InlineAI from './InlineAI';
import TerminalBlockList, { hasVisibleContent } from './TerminalBlockList';
import TerminalPanel from './TerminalPanel';
import SessionHistoryView from '../components/SessionHistoryView';
import SettingsView from '../settings/SettingsView';
import ContextMenu from '../components/ContextMenu';

export default function TerminalView() {
  const tabs = useWorkspaceStore((s) => s.tabs);
  const activeId = useWorkspaceStore((s) => s.activeId);
  const setWindowLayout = useWorkspaceStore((s) => s.setWindowLayout);
  const setSession = useTerminalStore((s) => s.setSession);
  const setFocusedPane = useTerminalStore((s) => s.setFocusedPane);
  const focusedPaneId = useTerminalStore((s) => s.focusedPaneId);
  const sessions = useTerminalStore((s) => s.sessions);
  const altScreenActive = useTerminalStore((s) => s.altScreenActive);
  const messages = useActiveMessages();
  const aiMessagesEnd = useRef<HTMLDivElement>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const splitPlacement = useUiStore((s) => s.splitPlacement);
  const cancelSplit = useUiStore((s) => s.cancelSplit);

  const activeTab = tabs.find((t) => t.id === activeId);
  const isHistoryTab = activeTab?.kind === 'history';
  const isSettingsTab = activeTab?.kind === 'settings';
  const isSession = activeTab?.kind === 'session';

  const layout = isSession ? activeTab!.layout : null;
  const focusedTermId = isSession
    ? (focusedPaneId && sessions[focusedPaneId] && layoutLeaves(activeTab!.layout).some((t) => t.id === focusedPaneId)
        ? focusedPaneId
        : firstLeaf(activeTab!.layout).id)
    : activeId;

  const scene = useTerminalStore((s) => s.scenes[focusedTermId] ?? 'classic');
  const focusBlocks = useBlockStore(selectBlocks(focusedTermId));
  const hasExecutingBlock = focusBlocks.some((b) => b.status === 'executing');
  useTerminalFocus(scene === 'blockList' && hasExecutingBlock, focusedTermId);

  useEffect(() => {
    aiMessagesEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, messages[messages.length - 1]?.content.length]);

  // 分裂落点：smart 规则（dropTargets 决定 1→4 半屏 / 2→4 四分之一 / 3→2 半屏 / 4→无）
  const placementTargets = useMemo(
    () => (splitPlacement.open && layout ? dropTargets(layout) : []),
    [splitPlacement.open, layout],
  );

  const commitPlacement = useCallback((zone: DropTarget) => {
    if (!layout) return;
    // 继承类型：优先继承「被分裂的那个终端」（zone.leafId），而非聚焦终端
    const base = splitPlacement.spec ?? findLeaf(layout, zone.leafId);
    if (!base) return;
    const newId = nextTerminalId(activeId, layout);
    const next = splitLeaf(layout, zone.leafId, zone.dir, zone.position, { ...base, id: newId });
    setWindowLayout(activeId, next);
    setFocusedPane(newId);
    cancelSplit();
  }, [layout, splitPlacement.spec, activeId, setWindowLayout, setFocusedPane, cancelSplit]);

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
      {isHistoryTab ? (
        <SessionHistoryView />
      ) : isSettingsTab ? (
        <SettingsView />
      ) : isSession && layout ? (
        <LayoutTree
          node={layout}
          windowId={activeId}
          focusedTermId={focusedTermId}
          setSession={setSession}
          setFocusedPane={setFocusedPane}
          setRatioNode={(aId, bId, r) => setWindowLayout(activeId, setRatio(layout, aId, bId, r))}
          onPaneContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY }); }}
        />
      ) : (
        <LoadingState />
      )}

      {/* AI 对话面板（活跃窗口的 AI 对话，全局显示在布局下方） */}
      {isSession && (
        <div style={{
          maxHeight: messages.length > 0 ? '35%' : '0px',
          overflow: 'hidden', flexShrink: 0,
          borderBottom: messages.length > 0 ? '1px solid var(--border)' : 'none',
          background: 'var(--surface)', transition: 'max-height 0.25s ease, border 0.25s ease',
        }}>
          {messages.length > 0 && (<><InlineAI /><div ref={aiMessagesEnd} /></>)}
        </div>
      )}

      {/* 手动全屏宿主（块终端「进入全屏交互」） */}
      {altScreenActive && (
        <div data-testid="tui-fullscreen" style={{ position: 'absolute', inset: 0, zIndex: 100, background: 'var(--canvas)', padding: '28px 8px 8px' }} />
      )}

      {/* 终端区域右键菜单 */}
      {ctxMenu && (
        <ContextMenu
          anchor={ctxMenu}
          onClose={() => setCtxMenu(null)}
          items={[
            { label: '分裂终端（选位置）', onClick: () => useUiStore.getState().beginSplit(null) },
            { label: '选择类型分裂', onClick: () => useUiStore.getState().openSplitPicker() },
            { label: '关闭终端', danger: true, onClick: () => useWorkspaceStore.getState().closeFocusedTerminal() },
          ]}
        />
      )}

      {/* 分裂落点选择覆盖层 */}
      {splitPlacement.open && (
        <PlacementOverlay targets={placementTargets} onPick={commitPlacement} onCancel={cancelSplit} />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// 布局树递归渲染
// ═══════════════════════════════════════════════════════════

interface InnerEdges { left: boolean; right: boolean; top: boolean; bottom: boolean; }

function LayoutTree(props: {
  node: WindowLayout;
  windowId: string;
  focusedTermId: string;
  setSession: (id: string, sid: string) => void;
  setFocusedPane: (id: string) => void;
  setRatioNode: (aId: string, bId: string, ratio: number) => void;
  onPaneContextMenu: (e: React.MouseEvent) => void;
  inner?: InnerEdges;
}) {
  const { node, windowId, focusedTermId, setSession, setFocusedPane, setRatioNode, onPaneContextMenu } = props;
  const inner = props.inner ?? { left: false, right: false, top: false, bottom: false };

  if (node.type === 'leaf') {
    return (
      <TerminalPane
        terminal={node.terminal}
        windowId={windowId}
        focused={node.terminal.id === focusedTermId}
        setSession={setSession}
        setFocusedPane={setFocusedPane}
        onContextMenu={onPaneContextMenu}
        inner={inner}
      />
    );
  }

  const dir = node.dir;
  const ratio = Math.max(0.1, Math.min(0.9, node.ratio));
  const aId = firstLeaf(node.first).id;
  const bId = firstLeaf(node.second).id;
  const firstInner: InnerEdges = dir === 'row' ? { ...inner, right: true } : { ...inner, bottom: true };
  const secondInner: InnerEdges = dir === 'row' ? { ...inner, left: true } : { ...inner, top: true };

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: dir === 'row' ? 'row' : 'column', background: 'var(--surface)' }}>
      <div style={{ flexBasis: `${ratio * 100}%`, flexGrow: 0, flexShrink: 0, minWidth: 0, minHeight: 0, display: 'flex' }}>
        <LayoutTree node={node.first} windowId={windowId} focusedTermId={focusedTermId} setSession={setSession} setFocusedPane={setFocusedPane} setRatioNode={setRatioNode} onPaneContextMenu={onPaneContextMenu} inner={firstInner} />
      </div>
      <Divider dir={dir} onRatio={(r) => setRatioNode(aId, bId, r)} />
      <div style={{ flexGrow: 1, flexBasis: 0, minWidth: 0, minHeight: 0, display: 'flex' }}>
        <LayoutTree node={node.second} windowId={windowId} focusedTermId={focusedTermId} setSession={setSession} setFocusedPane={setFocusedPane} setRatioNode={setRatioNode} onPaneContextMenu={onPaneContextMenu} inner={secondInner} />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// 分隔线（拖拽调比例）
// ═══════════════════════════════════════════════════════════

function Divider({ dir, onRatio }: { dir: 'row' | 'col'; onRatio: (r: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const isRow = dir === 'row';

  const onDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const container = ref.current?.parentElement;
    if (!container) return;
    const cRect = container.getBoundingClientRect();
    const move = (ev: MouseEvent) => {
      const r = isRow ? (ev.clientX - cRect.left) / cRect.width : (ev.clientY - cRect.top) / cRect.height;
      onRatio(Math.max(0.1, Math.min(0.9, r)));
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  };

  return (
    <div
      ref={ref}
      onMouseDown={onDown}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent-bg)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      style={{
        flexShrink: 0,
        width: isRow ? 6 : 'auto',
        height: isRow ? 'auto' : 6,
        cursor: isRow ? 'col-resize' : 'row-resize',
        transition: 'background 0.12s ease',
      }}
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
}) {
  const { terminal, windowId, focused, setSession, setFocusedPane, onContextMenu, inner } = props;
  const scene = useTerminalStore((s) => s.scenes[terminal.id] ?? 'classic');
  const altScreenActive = useTerminalStore((s) => s.altScreenActive);
  // 真实 alt buffer（vim/htop）显示主 xterm；手动全屏（块终端）时 xterm 是空壳，隐藏
  const showXterm = scene === 'classic' || (scene === 'altScreen' && !altScreenActive);
  const showBlocks = scene === 'blockList';

  return (
    <div
      data-testid={`pane-${terminal.id}`}
      data-focused={focused ? 'true' : 'false'}
      onClick={() => setFocusedPane(terminal.id)}
      onContextMenu={(e) => { setFocusedPane(terminal.id); onContextMenu(e); }}
      style={{
        flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column',
        position: 'relative', background: 'var(--surface)',
        // 只在「面向其它终端」的边上画线，外缘不画 —— 避免与侧栏的 1px 边框叠加成重线
        borderTop: inner.top ? `1px solid ${focused ? 'var(--border-strong)' : 'var(--border)'}` : 'none',
        borderBottom: inner.bottom ? `1px solid ${focused ? 'var(--border-strong)' : 'var(--border)'}` : 'none',
        borderLeft: inner.left ? `1px solid ${focused ? 'var(--border-strong)' : 'var(--border)'}` : 'none',
        borderRight: inner.right ? `1px solid ${focused ? 'var(--border-strong)' : 'var(--border)'}` : 'none',
        overflow: 'hidden',
      }}
    >
      {/* xterm 表面：classic/真实 altScreen 可见，blockList/手动全屏隐藏但保持挂载 */}
      <div style={showXterm
        ? { flex: 1, minHeight: 0, position: 'relative' }
        : { position: 'absolute', inset: 0, opacity: 0, pointerEvents: 'none' }}>
        <TerminalPanel paneId={terminal.id} tabId={windowId} onReady={(sid) => setSession(terminal.id, sid)} />
      </div>

      {/* 块列表：始终挂载（手动全屏时 RunningTerm 需保持存活），blockList 才可见 */}
      <div style={{ display: showBlocks ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'column' }}>
        <PaneBlockList paneId={terminal.id} insetLeft={inner.left ? 4 : 8} insetRight={inner.right ? 4 : 8} />
      </div>
      {showBlocks && <PaneInputEditor paneId={terminal.id} />}
      {scene === 'altScreen' && <TuiBanner tabId={terminal.id} />}
    </div>
  );
}

// ── 分裂落点选择覆盖层 ──

function PlacementOverlay({ targets, onPick, onCancel }: {
  targets: DropTarget[];
  onPick: (t: DropTarget) => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (targets.length === 0) {
      useToastStore.getState().addToast('最多 4 个终端', 'info');
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
  }, [targets.length, onCancel]);

  return (
    <div onClick={onCancel} style={{ position: 'absolute', inset: 0, zIndex: 80, background: 'rgba(0,0,0,0.15)' }}>
      {/* 完整目标区淡显（不可点） */}
      {targets.map((t, i) => (
        <div
          key={`fg-${i}`}
          style={{
            position: 'absolute',
            left: `${t.rect.x * 100}%`, top: `${t.rect.y * 100}%`,
            width: `${t.rect.w * 100}%`, height: `${t.rect.h * 100}%`,
            borderRadius: 6, boxSizing: 'border-box',
            border: '1px dashed var(--accent)', background: 'var(--accent-bg)',
            opacity: 0.35, pointerEvents: 'none',
          }}
        />
      ))}

      {/* 点击条带 + 方向图标 */}
      {targets.map((t, i) => {
        // 命中区收缩到「靠新终端那一侧」的边沿条带，避免半屏之间重叠导致无法点击
        const hit = t.dir === 'row'
          ? (t.position === 'first'
              ? { x: t.rect.x, y: t.rect.y, w: t.rect.w * 0.3, h: t.rect.h }
              : { x: t.rect.x + t.rect.w * 0.7, y: t.rect.y, w: t.rect.w * 0.3, h: t.rect.h })
          : (t.position === 'first'
              ? { x: t.rect.x, y: t.rect.y, w: t.rect.w, h: t.rect.h * 0.3 }
              : { x: t.rect.x, y: t.rect.y + t.rect.h * 0.7, w: t.rect.w, h: t.rect.h * 0.3 });
        const Icon = t.dir === 'row' ? (t.position === 'first' ? ArrowLeft : ArrowRight) : (t.position === 'first' ? ArrowUp : ArrowDown);
        return (
          <div
            key={i}
            data-testid={`placement-zone-${i}`}
            onClick={(e) => { e.stopPropagation(); onPick(t); }}
            title={t.dir === 'row' ? (t.position === 'first' ? '放到左侧' : '放到右侧') : (t.position === 'first' ? '放到上方' : '放到下方')}
            style={{
              position: 'absolute',
              left: `${hit.x * 100}%`, top: `${hit.y * 100}%`,
              width: `${hit.w * 100}%`, height: `${hit.h * 100}%`,
              borderRadius: 6, boxSizing: 'border-box',
              border: '1px dashed var(--accent)', background: 'var(--accent-bg)',
              cursor: 'pointer', color: 'var(--accent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Icon size={15} />
          </div>
        );
      })}

      {/* 提示条 */}
      <div style={{
        position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)',
        padding: '4px 12px', borderRadius: 6, fontSize: 11,
        background: 'var(--elevated)', border: '1px solid var(--border-strong)',
        color: 'var(--text-secondary)', boxShadow: 'var(--shadow-lg)',
        pointerEvents: 'none',
      }}>
        点击高亮区域放置新终端 · Esc 取消
      </div>
    </div>
  );
}

// ── TuiBanner（altScreen 应用：vim/htop 等） ──

function TuiBanner({ tabId }: { tabId: string }) {
  const setAltScreenActive = useTerminalStore((s) => s.setAltScreenActive);
  const setScene = useTerminalStore((s) => s.setScene);
  const altScreenActive = useTerminalStore((s) => s.altScreenActive);
  const sessions = useTerminalStore((s) => s.sessions);
  const blocks = useBlockStore(selectBlocks(tabId));
  const [killArmed, setKillArmed] = useState(false);
  const killTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (killTimer.current) clearTimeout(killTimer.current); }, []);
  const runningCommand = useMemo(() => {
    const running = blocks.filter((b) => b.status === 'executing');
    return running.length > 0 ? running[running.length - 1]!.command : '';
  }, [blocks]);
  const sendCtrlC = useCallback(() => {
    const sid = sessions[tabId];
    if (sid) ptyWrite(sid, '\x03').catch(() => {});
  }, [sessions, tabId]);
  const killApp = useCallback(() => {
    const sid = sessions[tabId];
    if (!sid) return;
    killForeground(sid).then((level) => {
      if (killTimer.current) clearTimeout(killTimer.current);
      if (level === 'term') { setKillArmed(true); killTimer.current = setTimeout(() => setKillArmed(false), ESCALATE_WINDOW_MS); }
      else setKillArmed(false);
    }).catch((e) => useToastStore.getState().addToast(String((e as Error)?.message ?? e), 'info'));
  }, [sessions, tabId]);
  return (
    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 101, padding: '4px 12px', fontSize: 11, fontFamily: 'var(--font-mono)', background: 'var(--surface)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-secondary)' }}>
      <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'var(--accent-warm)', flexShrink: 0 }} />
      <span>TUI{runningCommand ? ` · ${runningCommand}` : ''}</span>
      <div style={{ flex: 1 }} />
      <span onClick={sendCtrlC} title="发送 Ctrl+C" style={{ fontSize: 10, padding: '1px 6px', border: '1px solid var(--border)', borderRadius: 3, cursor: 'pointer' }}>^C</span>
      <span onClick={killApp} title="结束前台应用 (SIGTERM)" style={{ fontSize: 10, padding: '1px 6px', border: `1px solid ${killArmed ? 'var(--accent-warm)' : 'var(--border)'}`, borderRadius: 3, cursor: 'pointer', color: killArmed ? 'var(--accent-warm)' : 'var(--text-secondary)' }}>{killArmed ? '强杀!' : '结束'}</span>
      {altScreenActive && (
        <span onClick={() => { setAltScreenActive(false); setScene(tabId, 'blockList'); }} title="退出全屏" style={{ fontSize: 10, padding: '1px 6px', border: '1px solid var(--border)', borderRadius: 3, cursor: 'pointer' }}>esc</span>
      )}
    </div>
  );
}

// ── LoadingState ──

function LoadingState() {
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--canvas)', color: 'var(--text-muted)', fontSize: 13, userSelect: 'none', gap: 10 }}>
      <div style={{ width: 24, height: 24, borderRadius: '50%', border: '2px solid var(--border)', borderTopColor: 'var(--accent)', animation: 'spin 0.8s linear infinite' }} />
      <div style={{ color: 'var(--text-secondary)' }}>正在启动 Shell…</div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ── PaneInputEditor（终端 pane 的独立输入栏） ──

function PaneInputEditor({ paneId }: { paneId: string }) {
  const blocks = useBlockStore(selectBlocks(paneId));
  const hasRunningBlock = blocks.some((b) => b.status === 'executing' && b.wasLongRunning);
  const runningCommand = [...blocks].reverse().find((b) => b.status === 'executing')?.command ?? '';
  return (
    <InputEditor
      paneId={paneId}
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
  const snap = useFollowBottom(scrollRef, [blocks]);
  useEffect(() => registerFollowEngager(paneId, snap), [paneId, snap]);
  return (
    <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', background: 'var(--surface)' }}>
      <div style={{ paddingBottom: 8 }}>
        <TerminalBlockList tabId={paneId} insetLeft={insetLeft} insetRight={insetRight} />
        <PaneEmptyHint paneId={paneId} />
      </div>
    </div>
  );
}

function PaneEmptyHint({ paneId }: { paneId: string }) {
  const blocks = useBlockStore(selectBlocks(paneId));
  if (blocks.some(hasVisibleContent)) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', paddingTop: '8vh', color: 'var(--text-muted)', fontSize: 12, userSelect: 'none', gap: 6 }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 18, color: 'var(--text-muted)', opacity: 0.25, fontWeight: 600, marginBottom: 6 }}>$</div>
      <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>在下方输入命令</div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', opacity: 0.6, fontFamily: 'var(--font-mono)' }}>Enter 执行 · Shift+Enter 换行</div>
    </div>
  );
}
