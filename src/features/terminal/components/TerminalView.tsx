/**
 * TerminalView — 终端主表面（窗口 = 会话容器，持有 1–4 个终端的二叉分裂树）。
 *
 *   渲染活跃窗口的布局树：
 *     - leaf → 终端 pane（隐藏 xterm 驱动 PTY + 块列表 + 独立输入栏 + 类型下拉）
 *     - split → 行/列 flex + 可拖拽分隔线（调宽/高）
 *   分裂用 ⌘D/⌘⇧D（继承类型）、⌥⌘D（选类型）；分隔线拖动调整比例。
 */

import { COMMAND_BLOCK_CONTENT_PADDING } from '../model/commandBlockLayout';
import { showsPaneChatHistory } from '../model/paneHistory';
import { useTypographyStore } from '@config/typography';
import { useRef, useEffect, useLayoutEffect, useMemo, useState, useId, useCallback } from 'react';
import OverlayScrollbar from '@ui/OverlayScrollbar';
import { CircleX, Minimize2, Square } from '@ui/icons';
import { STATUS_ACTION_ICON_SIZE, StatusActionButton, TerminalStatusBar } from '@features/terminal/components/TerminalStatusBar';
import { MoveDragLayer, PlacementOverlay } from './TerminalPlacementOverlay';
import { useSessionStore, type Tab } from '@features/workspace';
import { useTerminalStore } from '@features/terminal';
import { useUiStore, useDockDragStore } from '@features/workspace';
import { useBlockStore, selectBlocks } from '@features/terminal';
import { usePaneMessages } from '@features/chat';
import PaneChatHistory from '@features/chat/components/PaneChatHistory';
import { useToastStore } from '@ui/Toast';
import { useFollowBottom, registerFollowEngager, engageFollow } from '@features/terminal/hooks/useFollowBottom';
import { useTerminalFocus } from '@features/terminal/hooks/useTerminalFocus';
import { useTerminalPaneDrag } from '@features/terminal/hooks/useTerminalPaneDrag';
import { useRunningCommandActions } from '@features/terminal/hooks/useRunningCommandActions';
import {
  leaves as layoutLeaves, firstLeaf, dividers, collectLayoutCells, fitLayoutWidth, MIN_PANE_SIZE, MIN_PANE_WIDTH, DIVIDER_SIZE,
  type WindowLayout, type TerminalSpec, type Rect,
} from '@features/workspace/model/windowLayout';
import InputEditor from '@features/terminal/components/InputEditor';
import TerminalBlockList, { hasVisibleContent } from '@features/terminal/components/TerminalBlockList';
import PinnedCommand from './PinnedCommand';
import { usePinnedCommand } from '../hooks/usePinnedCommand';
import TerminalPanel from '@features/terminal/components/TerminalPanel';
import { SessionHistoryView } from '@features/session-history';
import AiHistoryView from '@features/chat/components/AiHistoryView';
import SettingsView from '@features/settings/pages/SettingsView';
import ContextMenu, { type ContextMenuItem } from '@ui/ContextMenu';
import ErrorBox from '@ui/ErrorBox';
import { TextButton } from '@ui/TextButton';
import { useTerminalLayoutActions } from '@features/terminal/hooks/useTerminalLayoutActions';
import { useTuiControls } from '@features/terminal/hooks/useTuiControls';
import { copyTerminalSelection, getPaneTerminal, pasteClipboardIntoTerminal } from '@features/terminal/services/terminalClipboard';
import { t } from '@i18n';
import { focusSessionInput } from '../services/terminalFocus';
import { TerminalRedrawButton } from './TerminalRedrawButton';
import SshStatusPanel from '@features/ssh/components/SshStatusPanel';
import type { SshSessionStatus } from '@core/ssh';

export default function TerminalView() {
  const tabs = useSessionStore((s) => s.tabs);
  const activeId = useSessionStore((s) => s.activeId);
  const setSession = useTerminalStore((s) => s.setSession);
  const setFocusedPane = useTerminalStore((s) => s.setFocusedPane);
  const focusedPaneId = useTerminalStore((s) => s.focusedPaneId);
  const sessions = useTerminalStore((s) => s.sessions);
  const altScreenActive = useTerminalStore((s) => s.altScreenActive);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; sshActions?: ContextMenuItem[]; fullscreen?: boolean } | null>(null);

  const activeTab = tabs.find((t) => t.id === activeId);
  const isSession = activeTab?.kind === 'session';

  const focusedTermId = isSession
    ? (focusedPaneId && sessions[focusedPaneId] && layoutLeaves(activeTab!.layout).some((t) => t.id === focusedPaneId)
        ? focusedPaneId
        : firstLeaf(activeTab!.layout).id)
    : activeId;

  // Running commands expose the status-bar actions through the context menu as well.
  const focusedScene = useTerminalStore((s) => s.scenes[focusedTermId] ?? 'classic');
  const focusedBlocks = useBlockStore(selectBlocks(focusedTermId));
  const hasRunningBlock = focusedScene === 'blockList' && focusedBlocks.some((block) => block.status === 'executing');
  const fullscreenMenu = ctxMenu?.fullscreen === true;
  const runningActions = useRunningCommandActions(focusedTermId, fullscreenMenu ? 'fullscreen' : 'block');
  const copySelection = () => { void copyTerminalSelection(getPaneTerminal(focusedTermId)); };
  const pasteIntoPane = () => { void pasteClipboardIntoTerminal(focusedTermId); };
  const ctxMenuItems: ContextMenuItem[] = !ctxMenu ? [] : fullscreenMenu ? [
    ...runningActions,
    { label: t('terminal.menu.copy'), group: 'clipboard', shortcut: 'Ctrl+C', onClick: copySelection },
    { label: t('terminal.menu.paste'), group: 'clipboard', shortcut: 'Ctrl+V', onClick: pasteIntoPane },
  ] : [
    ...(hasRunningBlock ? runningActions : []),
    ...(ctxMenu.sshActions ?? []),
    { label: t('terminal.menu.copy'), group: 'clipboard', shortcut: 'Ctrl+C', onClick: copySelection },
    { label: t('terminal.menu.paste'), group: 'clipboard', shortcut: 'Ctrl+V', onClick: pasteIntoPane },
    { label: t('Split terminal (choose position)'), group: 'view', onClick: () => useUiStore.getState().beginSplit(null) },
    { label: t('Choose split type'), group: 'view', onClick: () => useUiStore.getState().openSplitPicker() },
    { label: t('Move terminal'), group: 'view', onClick: () => useUiStore.getState().beginMove(focusedTermId) },
    { label: t('Close this terminal'), danger: true, onClick: () => useSessionStore.getState().closeFocusedTerminal() },
  ];

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
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
              onPaneContextMenu={(e, sshActions) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, sshActions }); }}
            />
          );
        }
        if (tab.id !== activeId) return null; // history/settings 无 PTY，无需保活
        return tab.kind === 'history' ? <SessionHistoryView key={tab.id} />
          : tab.kind === 'ai-history' ? <AiHistoryView key={tab.id} /> : <SettingsView key={tab.id} />;
      })}

      {/* Manual fullscreen host for a running block, with room for the toolbar. */}
      {altScreenActive && (
        <div
          data-testid="tui-fullscreen"
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setCtxMenu({ x: event.clientX, y: event.clientY, fullscreen: true });
          }}
          style={{ position: 'absolute', inset: 0, zIndex: 100, background: 'var(--xterm-bg)', paddingTop: 28 }}
        >
          <TuiBanner tabId={focusedTermId} />
        </div>
      )}

      {/* 终端区域右键菜单 */}
      {ctxMenu && (
        <ContextMenu
          anchor={ctxMenu}
          onClose={() => setCtxMenu(null)}
          items={ctxMenuItems}
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
  onPaneContextMenu: (e: React.MouseEvent, sshActions?: ContextMenuItem[]) => void;
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
  useLayoutEffect(() => {
    if (active) focusSessionInput(focusedTermId);
  }, [active, focusedTermId, scene, hasExecutingBlock, sessions[focusedTermId]]);

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

        {/* Split slot picker (anchored to the layout area so it mirrors the future regions). */}
        {active && splitPlacement.open && (
          <PlacementOverlay targets={placementTargets} onPick={commitPlacement} onCancel={cancelSplit} />
        )}

        {/* Replace-position picker (menu entry, same slots as dragging a pane). */}
        {active && movePlacement.open && (
          <PlacementOverlay
            targets={movePlacementTargets}
            emptyMessage={t('A single terminal cannot be moved')}
            onPick={completeMove}
            onCancel={cancelMove}
          />
        )}

        {/* Pane drag placement layer. */}
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
  onPaneContextMenu: (e: React.MouseEvent, sshActions?: ContextMenuItem[]) => void;
}) {
  const { layout: savedLayout, windowId, focusedTermId, setSession, setFocusedPane, setRatioNode, onPaneContextMenu } = props;
  const layoutRef = useRef<HTMLDivElement>(null);
  const [layoutWidth, setLayoutWidth] = useState(0);
  useEffect(() => {
    const element = layoutRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setLayoutWidth(element.clientWidth));
    observer.observe(element);
    setLayoutWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);
  const layout = useMemo(() => layoutWidth > 0 ? fitLayoutWidth(savedLayout, layoutWidth) : savedLayout, [savedLayout, layoutWidth]);
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
    <div ref={layoutRef} style={{ position: 'relative', flex: 1, minWidth: 0, minHeight: 0 }}>
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
      // Horizontal panes reserve room for their controls; vertical splits keep their height limit.
      const minimum = (isRow ? MIN_PANE_WIDTH : MIN_PANE_SIZE) + DIVIDER_SIZE / 2;
      const minRatio = Math.min(0.5, minimum / size);
      const maxRatio = Math.max(0.5, 1 - minimum / size);
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
      data-testid={`terminal-divider-${dir}`}
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
  onContextMenu: (e: React.MouseEvent, sshActions?: ContextMenuItem[]) => void;
  inner: InnerEdges;
  reorderable: boolean;
}) {
  const { terminal, windowId, focused, setSession, setFocusedPane, onContextMenu, inner, reorderable } = props;
  const [sshState, setSshState] = useState<SshSessionStatus>({ phase: 'connecting', reconnectAttempt: 0, retrying: false, log: [] });
  const [sshStatusWidth, setSshStatusWidth] = useState(300);
  const [sshToolbarHost, setSshToolbarHost] = useState<HTMLDivElement | null>(null);
  const [sshStatusTrigger, setSshStatusTrigger] = useState<HTMLButtonElement | null>(null);
  const [sshStatusToggleRequest, setSshStatusToggleRequest] = useState(0);
  const [sshPanelOpen, setSshPanelOpen] = useState(false);
  const [sshStatusOpenRequest, setSshStatusOpenRequest] = useState(0);
  const reconnectAction = useRef<(() => Promise<void>) | null>(null);
  const disconnectAction = useRef<(() => Promise<void>) | null>(null);
  const registerDisconnect = useCallback((action: (() => Promise<void>) | null) => { disconnectAction.current = action; }, []);
  const registerReconnect = useCallback((action: (() => Promise<void>) | null) => { reconnectAction.current = action; }, []);
  const activeTabId = useSessionStore(s => s.activeId);
  const scene = useTerminalStore((s) => s.scenes[terminal.id] ?? 'classic');
  const [enteredBlockMode, setEnteredBlockMode] = useState(false);
  useEffect(() => { setEnteredBlockMode(false); }, [terminal.ssh?.connectionId, terminal.ssh?.host, terminal.openMode]);
  useEffect(() => { if (scene === 'blockList') setEnteredBlockMode(true); }, [scene]);
  const altScreenActive = useTerminalStore((s) => s.altScreenActive);
  // An SSH pane's classic scene is its connection/auth surface; the pane's chat
  // history stays out of the way so that surface owns the pane.
  const showChatHistory = showsPaneChatHistory(scene, terminal.kind);
  // Real alternate buffers use the main xterm; manual fullscreen uses the live block terminal.
  const disconnectedBlock = terminal.kind === 'ssh' && terminal.openMode === 'block' && enteredBlockMode && sshState.phase === 'disconnected';
  const showXterm = !disconnectedBlock && (scene === 'classic' || (scene === 'altScreen' && !altScreenActive));
  const showBlocks = scene === 'blockList' || disconnectedBlock;
  const blockPresentation = terminal.kind === 'ssh' && terminal.openMode === 'block' && (scene === 'blockList' || (scene === 'altScreen' && enteredBlockMode) || disconnectedBlock);
  const reconnectSsh = async () => { await reconnectAction.current?.(); };
  const sshActions: ContextMenuItem[] = blockPresentation ? [
    { label: t('SSH status'), group: 'view', onClick: () => setSshStatusOpenRequest(value => value + 1) },
    { label: t(sshState.phase === 'disconnected' || sshState.retrying ? 'Reconnect SSH session' : 'ssh.action.disconnect'), group: 'primary', onClick: () => {
      const action = sshState.phase === 'disconnected' || sshState.retrying ? reconnectAction.current : disconnectAction.current;
      void action?.().catch(reason => useToastStore.getState().addToast(String(reason), 'error'));
    } },
  ] : [];

  const onPaneMouseDown = useTerminalPaneDrag(terminal.id, reorderable);

  const paneContent = (
    <div className="ssh-pane-content" style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
      {/* Keep xterm mounted; hide it only while the block terminal is manually fullscreened. */}
      {showChatHistory && <PaneChatHistory paneId={terminal.id} />}
      <div inert={!showXterm} style={showXterm
        // Keep the native terminal scrollbar flush with the pane's right edge.
        // Keep left padding on terminal output so authentication inputs stay centered.
        ? { flex: 1, minHeight: 0, position: 'relative', padding: '8px 0 0 0', paddingTop: scene === 'altScreen' ? 28 : 8, background: 'transparent' }
        : { position: 'absolute', inset: 0, opacity: 0, pointerEvents: 'none' }}>
        <TerminalPanel
          paneId={terminal.id}
          tabId={windowId}
          connectionInput={terminal.kind === 'ssh'}
          connectionId={terminal.ssh?.connectionId}
          sshTarget={terminal.ssh ? `${terminal.ssh.user ? `${terminal.ssh.user}@` : ''}${terminal.ssh.host}` : undefined}
          onReady={(sid) => setSession(terminal.id, sid)}
          onSshStateChange={setSshState}
          onReconnectReady={registerReconnect}
          toolbarHost={sshToolbarHost}
          showToolbar={!blockPresentation}
          onSessionStatusClick={() => setSshStatusToggleRequest(value => value + 1)}
          onSessionStatusReady={setSshStatusTrigger}
          sessionStatusOpen={sshPanelOpen}
          onDisconnectReady={registerDisconnect}
        />
      </div>

      {/* Keep the block list mounted so its live terminal survives manual fullscreen. */}
      <div inert={!showBlocks} style={{ display: showBlocks ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'column' }}>
        <PaneBlockList paneId={terminal.id} insetLeft={inner.left ? 4 : 8} insetRight={inner.right ? 4 : 8} />
      </div>
      {showBlocks && (
        <PaneInputEditor
          paneId={terminal.id}
          focused={focused}
          insetLeft={inner.left ? 4 : 8}
          insetRight={inner.right ? 4 : 8}
          onSessionStatusClick={blockPresentation ? () => setSshStatusToggleRequest(value => value + 1) : undefined}
          onSessionStatusReady={blockPresentation ? setSshStatusTrigger : undefined}
          sessionStatusOpen={sshPanelOpen}
          sessionNotice={blockPresentation && sshState.phase === 'disconnected' ? <ErrorBox compact tone="info" style={{ margin: '0 8px 8px' }} actions={<TextButton onClick={() => { void reconnectSsh().catch(reason => useToastStore.getState().addToast(String(reason), 'error')); }}>{t('Reconnect SSH session')}</TextButton>}>{t('Disconnected')}</ErrorBox> : undefined}
        />
      )}
      {scene === 'altScreen' && !altScreenActive && <TuiBanner tabId={terminal.id} />}
    </div>
  );

  return (
    <div
      data-testid={`pane-${terminal.id}`}
      className="terminal-pane"
      data-focused={focused ? 'true' : 'false'}
      onClick={() => setFocusedPane(terminal.id)}
      onMouseDown={onPaneMouseDown}
      onContextMenu={(e) => { setFocusedPane(terminal.id); onContextMenu(e, sshActions); }}
      style={{
        flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column',
        position: 'relative',
        // Match terminal output, pane padding and block history to the classic background.
        background: 'var(--xterm-bg)',
        // Interior pane dividers keep the same appearance when focus moves.
        borderTop: inner.top ? '1px solid var(--border)' : 'none',
        borderBottom: inner.bottom ? '1px solid var(--border)' : 'none',
        borderLeft: inner.left ? '1px solid var(--border)' : 'none',
        borderRight: inner.right ? '1px solid var(--border)' : 'none',
        overflow: 'hidden',
      }}
    >
      {terminal.kind === 'ssh' && terminal.ssh ? <SshStatusPanel
        key={`${terminal.ssh.connectionId ?? ''}:${terminal.ssh.host}:${terminal.ssh.port ?? 22}`}
        paneId={terminal.id} target={terminal.ssh} state={sshState} active={activeTabId === windowId} focused={focused}
        width={sshStatusWidth} onWidthChange={setSshStatusWidth}
        onToolbarReady={setSshToolbarHost} compact={blockPresentation}
        statusTrigger={sshStatusTrigger} openRequest={sshStatusOpenRequest}
        toggleRequest={sshStatusToggleRequest} onOpenChange={setSshPanelOpen}
        onReconnect={reconnectSsh}
      >{paneContent}</SshStatusPanel> : paneContent}
    </div>
  );
}

// ── TuiBanner（altScreen 应用：vim/htop 等） ──

function TuiBanner({ tabId }: { tabId: string }) {
  const {
    altScreenActive,
    runningCommand,
    runningCwd,
    runningStartedAt,
    killArmed,
    sendCtrlC,
    killApp,
    exitFullScreen,
  } = useTuiControls(tabId);
  return (
    <div data-testid="tui-banner" style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 101, height: 28, padding: '0 12px', overflow: 'hidden', display: 'flex', alignItems: 'center' }}>
      <TerminalStatusBar
        alwaysShowActions
        cwd={runningCwd}
        startedAt={runningStartedAt}
        label={`TUI${runningCommand ? ` · ${runningCommand}` : ''}`}
        style={{ flex: 1, minWidth: 0, marginBottom: 0 }}
        actions={<>
          <TerminalRedrawButton paneId={tabId} />
          <StatusActionButton title={t('Interrupt command')} shortcut="Control+C" onClick={sendCtrlC} label={<Square size={STATUS_ACTION_ICON_SIZE} />} />
          <StatusActionButton title={killArmed ? t('Force quit foreground process') : t('Quit foreground process')} onClick={killApp} label={<CircleX size={STATUS_ACTION_ICON_SIZE} />} />
          {altScreenActive && <StatusActionButton title={t('Exit fullscreen')} onClick={exitFullScreen} label={<Minimize2 size={STATUS_ACTION_ICON_SIZE} />} />}
        </>}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// PaneInputEditor（终端 pane 的独立输入栏） ═══════════════════════════════════════════════════════════

function PaneInputEditor({ paneId, focused, insetLeft = 8, insetRight = 8, onSessionStatusClick, onSessionStatusReady, sessionNotice, sessionStatusOpen }: { paneId: string; focused: boolean; insetLeft?: number; insetRight?: number; onSessionStatusClick?: () => void; onSessionStatusReady?: (trigger: HTMLButtonElement | null) => void; sessionStatusOpen?: boolean; sessionNotice?: React.ReactNode }) {
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
      onSessionStatusClick={onSessionStatusClick}
      onSessionStatusReady={onSessionStatusReady}
      sessionStatusOpen={sessionStatusOpen}
      sessionNotice={sessionNotice}
      onEndPress={() => { engageFollow(paneId); useTerminalStore.getState().setKeyboardTarget('input'); }}
    />
  );
}

// ── PaneBlockList / PaneEmptyHint ──

function PaneBlockList({ paneId, insetLeft = 8, insetRight = 8 }: { paneId: string; insetLeft?: number; insetRight?: number }) {
  const blocks = useBlockStore(selectBlocks(paneId));
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollId = useId();
  const pinned = usePinnedCommand(scrollRef);
  const titleCollapsed = useTypographyStore(state => state.commandTitleCollapsed);
  const updateTypography = useTypographyStore(state => state.update);
  const pinnedBlock = pinned ? blocks.find(block => block.id === pinned.id) : undefined;
  const snap = useFollowBottom(scrollRef, [blocks], paneId);
  useEffect(() => registerFollowEngager(paneId, snap), [paneId, snap]);
  return (
    <div className="overlay-scroll-container" style={{ flex: 1, minHeight: 0 }}>
      <div ref={scrollRef} id={scrollId} className="scroll-region terminal-block-scroll" data-testid={`terminal-scroll-${paneId}`} style={{ flex: 1, minHeight: 0, overflowY: 'auto', background: 'var(--xterm-bg)', overflowAnchor: 'none', '--command-content-inset': `${insetLeft + insetRight + 2 * COMMAND_BLOCK_CONTENT_PADDING}px` } as React.CSSProperties}>
        <div data-testid={`terminal-flow-${paneId}`}>
          <TerminalBlockList tabId={paneId} insetLeft={insetLeft} insetRight={insetRight} />
          <PaneEmptyHint paneId={paneId} />
        </div>
      </div>
      {pinned && pinnedBlock && <PinnedCommand key={pinned.id} block={pinnedBlock} paneId={paneId}
        remaining={pinned.remaining} insetLeft={insetLeft} insetRight={insetRight} scrollRef={scrollRef}
        collapsed={titleCollapsed} onToggle={() => updateTypography({ commandTitleCollapsed: !titleCollapsed })} />}
      <OverlayScrollbar scrollRef={scrollRef} controlsId={scrollId} label={t('Scroll command history')} />
    </div>
  );
}

function PaneEmptyHint({ paneId }: { paneId: string }) {
  const blocks = useBlockStore(selectBlocks(paneId));
  const aiMessages = usePaneMessages(paneId);
  if (blocks.some(hasVisibleContent) || aiMessages.length > 0) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', padding: '32px 28px', color: 'var(--text-muted)', fontSize: 'calc(12px * var(--ui-font-scale))', userSelect: 'none', gap: 8 }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'calc(24px * var(--ui-font-scale))', color: 'var(--text-secondary)', fontWeight: 'var(--fw-medium)', marginBottom: 4 }}>$</div>
      <div style={{ color: 'var(--text-primary)', fontSize: 'calc(15px * var(--ui-font-scale))', fontWeight: 'var(--fw-medium)' }}>从一条命令开始</div>
      <div style={{ fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--text-secondary)' }}>在底部输入命令，或打开右上角 AI 助手。</div>
    </div>
  );
}
