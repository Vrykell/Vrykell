/**
 * Terminal surface: a window is a session container holding a binary split tree of one to four
 * terminals. The active window's layout renders as either a terminal pane (hidden xterm driving
 * the PTY, block list, input bar and type menu) or a row/column split with draggable dividers.
 * Splitting inherits the terminal type; the divider drag adjusts ratios.
 */

import { COMMAND_BLOCK_CONTENT_PADDING } from '../model/commandBlockLayout';
import { SplitPaneSurface } from '@ui/layout/SplitPane';
import WorkspacePaneCanvas from '@features/workspace/components/WorkspacePaneCanvas';
import { useWorkspaceResources } from '@features/workspace/hooks/useWorkspaceResources';
import { terminalWorkspaceLayout, workspacePaneCells } from '@features/workspace/model/workspaceResources';
import { useWorkspaceContainer, useWorkspacePaneControls } from '@features/workspace/hooks/useWorkspaceContainer';
import { detachWorkspacePane, mergeWorkspaceContainers, moveWorkspacePane } from '@features/workspace/services/workbench';
import { showsPaneChatHistory } from '../model/paneHistory';
import { useTypographyStore } from '@config/typography';
import { useRef, useEffect, useLayoutEffect, useState, useId, useCallback } from 'react';
import OverlayScrollbar from '@ui/layout/OverlayScrollbar';
import { CircleX, Minimize2, Square } from '@ui/icons';
import TerminalLauncher from '@features/workspace/components/TerminalLauncher';
import { STATUS_ACTION_ICON_SIZE, StatusActionButton, TerminalStatusBar } from '@features/terminal/components/TerminalStatusBar';
import { MoveDragLayer, PlacementOverlay } from './TerminalPlacementOverlay';
import { useSessionStore, useWorkspaceNavigation, type Tab } from '@features/workspace';
import { useTerminalStore, useInputStore } from '@features/terminal';
import { useUiStore, useDockDragStore } from '@features/workspace';
import { useBlockStore, selectBlocks } from '@features/terminal';
import { usePaneMessages } from '@features/chat';
import PaneChatHistory from '@features/chat/components/PaneChatHistory';
import { useToastStore } from '@ui/feedback/Toast';
import { useFollowBottom, registerFollowEngager, engageFollow } from '@features/terminal/hooks/useFollowBottom';
import { useTerminalFocus } from '@features/terminal/hooks/useTerminalFocus';
import { useTerminalPaneDrag } from '@features/terminal/hooks/useTerminalPaneDrag';
import { useRunningCommandActions } from '@features/terminal/hooks/useRunningCommandActions';
import {
  leaves as layoutLeaves, firstLeaf, collectLayoutCells,
  type WindowLayout, type TerminalSpec,
} from '@features/workspace/model/windowLayout';
import InputEditor from '@features/terminal/components/InputEditor';
import TerminalBlockList, { hasVisibleContent } from '@features/terminal/components/TerminalBlockList';
import PinnedCommand from './PinnedCommand';
import { usePinnedCommand } from '../hooks/usePinnedCommand';
import TerminalPanel from '@features/terminal/components/TerminalPanel';
import { UnifiedHistoryView } from '@features/session-history';
import ContextMenu, { type ContextMenuItem } from '@ui/menus/ContextMenu';
import ErrorBox from '@ui/feedback/ErrorBox';
import { TextButton } from '@ui/actions/TextButton';
import AiWorkspaceSurface from '@features/chat/components/AiWorkspaceSurface';
import { useTerminalLayoutActions } from '@features/terminal/hooks/useTerminalLayoutActions';
import { useTuiControls } from '@features/terminal/hooks/useTuiControls';
import { copyTerminalSelection, getPaneTerminal, pasteClipboardIntoTerminal } from '@features/terminal/services/terminalClipboard';
import { t } from '@i18n';
import { focusSessionInput } from '../services/terminalFocus';
import { TerminalRedrawButton } from './TerminalRedrawButton';
import SshStatusPanel from '@features/ssh/components/SshStatusPanel';
import type { SshSessionStatus } from '@core/ssh';
import { useManualFullscreenVisible } from '../hooks/useManualFullscreenVisible';
import ResourceContent from '@ui/layout/ResourceContent';
import { closeTerminalPane, requestWorkspaceSplit } from '@features/workspace/services/unifiedWorkspace';
import { detachCompositionPane, useUnifiedWorkspace } from '@features/workspace';
import { workspaceSplitMenu } from '@features/workspace/model/workspaceCreation';

export default function TerminalView({ active = true }: { active?: boolean }) {
  const area = useWorkspaceNavigation(state => state.area);
  const unified = area === 'unified';
  const nativeTerminal = area === 'terminal';
  const tabs = useSessionStore((s) => s.tabs);
  const activeId = useSessionStore((s) => s.activeId);
  const setSession = useTerminalStore((s) => s.setSession);
  const setFocusedPane = useTerminalStore((s) => s.setFocusedPane);
  const focusedPaneId = useTerminalStore((s) => s.focusedPaneId);
  const sessions = useTerminalStore((s) => s.sessions);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; sshActions?: ContextMenuItem[]; fullscreen?: boolean } | null>(null);

  const activeTab = tabs.find((t) => t.id === activeId);
  const isSession = activeTab?.kind === 'session';
  const unifiedPaneCount = useUnifiedWorkspace(state => state.layout ? workspacePaneCells(state.layout).length : 0);

  const focusedTermId = isSession
    ? (focusedPaneId && sessions[focusedPaneId] && layoutLeaves(activeTab!.layout).some((t) => t.id === focusedPaneId)
        ? focusedPaneId
        : firstLeaf(activeTab!.layout).id)
    : activeId;

  // Running commands expose the status-bar actions through the context menu as well.
  const focusedScene = useTerminalStore((s) => s.scenes[focusedTermId] ?? 'classic');
  const focusedBlocks = useBlockStore(selectBlocks(focusedTermId));
  const fullscreenMenu = ctxMenu?.fullscreen === true;
  // A real alternate screen renders the TUI on the main terminal and shows its banner in
  // the pane, so those toolbar actions join the pane menu as well.
  const manualFullscreen = useTerminalStore(s => !!s.manualFullscreen[focusedTermId]);
  const fullscreenVisible = useManualFullscreenVisible(focusedTermId);
  const tuiInPane = focusedScene === 'altScreen' && !manualFullscreen;
  const hasRunningCommand = (focusedScene === 'blockList' || tuiInPane) && focusedBlocks.some((block) => block.status === 'executing');
  const runningActions = useRunningCommandActions(focusedTermId, fullscreenMenu ? 'fullscreen' : tuiInPane ? 'altScreen' : 'block');
  const copySelection = () => { void copyTerminalSelection(getPaneTerminal(focusedTermId)); };
  const pasteIntoPane = () => { void pasteClipboardIntoTerminal(focusedTermId); };
  const paneCount = unified ? unifiedPaneCount : isSession ? layoutLeaves(activeTab!.layout).length : 0;
  const multiPane = paneCount > 1;
  const canSplit = paneCount > 0 && paneCount < 4;
  const beginPaneMoveAction = () => {
    const unifiedState = useUnifiedWorkspace.getState();
    const paneId = unified
      ? unifiedState.layout && workspacePaneCells(unifiedState.layout).find(cell => cell.resourceId === `terminal:${focusedTermId}`)?.id
      : focusedTermId;
    if (!paneId) return;
    useUiStore.getState().beginPaneMove(unified ? unifiedState.activeTabId : activeId, paneId);
  };
  const commonActions: ContextMenuItem[] = [
    ...(canSplit ? [{ ...workspaceSplitMenu(unified ? 'unified' : 'terminal', kind => requestWorkspaceSplit(`terminal:${focusedTermId}`, undefined, kind)), group: 'view' as const }] : []),
    ...[{
      label: t('Change pane position'), group: 'view' as const, disabled: !multiPane,
      onClick: beginPaneMoveAction,
    }, {
      label: t('Move pane to new tab'), group: 'view' as const, disabled: !multiPane,
      onClick: () => unified ? detachCompositionPane(`terminal:${focusedTermId}`) : useSessionStore.getState().detachTerminalPane(focusedTermId),
    }],
    ...(multiPane ? [{ label: t('Remove pane'), group: 'view' as const, onClick: () => closeTerminalPane(focusedTermId) }] : []),
    ...(!unified && !multiPane ? [{ label: t('Close this terminal'), group: 'view' as const, danger: true, onClick: () => closeTerminalPane(focusedTermId) }] : []),
  ];
  const paneActions: ContextMenuItem[] = [
    ...(fullscreenMenu ? runningActions : hasRunningCommand ? runningActions : []),
    ...(!fullscreenMenu ? ctxMenu?.sshActions ?? [] : []),
    { label: t('terminal.menu.copy'), group: 'clipboard', shortcut: 'Ctrl+C', onClick: copySelection },
    { label: t('terminal.menu.paste'), group: 'clipboard', shortcut: 'Ctrl+V', onClick: pasteIntoPane },
    ...commonActions,
  ];
  const ctxMenuItems: ContextMenuItem[] = !ctxMenu ? [] : paneActions;

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
      {tabs.flatMap(tab => tab.kind === 'session' ? layoutLeaves(tab.layout).map(terminal => ({ terminal, tab })) : [])
        .sort((a, b) => a.terminal.id.localeCompare(b.terminal.id)).map(({ terminal, tab }) => <ResourceContent key={terminal.id} id={`terminal:${terminal.id}`} active={active && tab.id === activeId}>
          {state => <TerminalPane terminal={terminal} windowId={tab.id} focused={state.visible && state.focused} placed={state.placed && unified}
            setSession={setSession} setFocusedPane={setFocusedPane} onContextMenu={(event, sshActions) => { event.preventDefault(); setCtxMenu({ x: event.clientX, y: event.clientY, sshActions }); }}
            inner={unified ? { left: false, right: false, top: false, bottom: false } : collectLayoutCells(tab.layout).find(cell => cell.terminalId === terminal.id)!.inner}
            reorderable={!unified && layoutLeaves(tab.layout).length > 1} />}
        </ResourceContent>)}
      {/* Keep every session tab mounted and hide inactive ones: unmounting runs the
          useTerminalSession cleanup, which closes the PTY and kills a running command. Hidden
          tabs keep their process, block list and offscreen terminal alive. */}
      {tabs.map((tab) => {
        if (tab.kind === 'session') {
          return (
            <SessionTabView
              key={tab.id}
              tab={tab}
              active={active && tab.id === activeId}
            />
          );
        }
        // One AI surface hosts the harness workspace for every AI page kind; it follows the active tab.
        if (tab.kind === 'harness' || tab.kind === 'ai-history' || tab.kind === 'usage' || tab.kind === 'start-ai') {
          if (tab.id !== activeId) return null;
          return <div key={tab.id} style={{ display: 'flex', flex: 1, minHeight: 0, minWidth: 0 }}>
            <AiWorkspaceSurface placement="main" />
          </div>;
        }
        if (tab.id !== activeId) return null;
        if (tab.kind === 'git-diff' || tab.kind === 'editor') return null;
        // Placeholder start page: a system singleton that keeps the workspace toolbar visible.
        if (tab.kind === 'start') return <TerminalLauncher key={tab.id} />;
        // The terminal workspace owns the terminal-history page; the persisted filter reopens its search.
        return tab.kind === 'history' ? <UnifiedHistoryView key={tab.id} preset="terminal" destination="native" /> : null;
      })}

      {/* Manual fullscreen host for a running block, with room for the toolbar. */}
      {nativeTerminal && active && fullscreenVisible && (
        <div
          data-testid="tui-fullscreen"
          data-pane-id={focusedTermId}
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

      {/* Terminal area context menu */}
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
// Single session tab surface: layout tree plus split/move overlays
// ═══════════════════════════════════════════════════════════

function SessionTabView(props: {
  tab: Extract<Tab, { kind: 'session' }>;
  active: boolean;
}) {
  const { tab, active } = props;
  const windowId = tab.id;
  const layout = tab.layout;
  const focusedPaneId = useTerminalStore((s) => s.focusedPaneId);
  const sessions = useTerminalStore((s) => s.sessions);
  const draggingId = useDockDragStore((s) => s.draggingTerminalId);

  const focusedTermId = focusedPaneId && sessions[focusedPaneId] && layoutLeaves(layout).some((t) => t.id === focusedPaneId)
    ? focusedPaneId
    : firstLeaf(layout).id;

  const {
    splitPlacement,
    cancelSplit,
    placementTargets,
    commitPlacement,
    commitMove,
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
        {/* Plane rendering: panes are keyed by terminal id and absolutely positioned, so reorder
            only changes geometry and never remounts TerminalPane (which would close the PTY). */}
        <PaneLayout
          windowId={windowId}
          layout={layout}
          focusedTermId={focusedTermId}
          active={active}
          setRatioNode={setRatioNode}
        />

        {/* Split slot picker (anchored to the layout area so it mirrors the future regions). */}
        {active && splitPlacement.open && (
          <PlacementOverlay targets={placementTargets} onPick={commitPlacement} onCancel={cancelSplit} hint={t('Click here to split the terminal')} />
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
// Layout plane rendering (PaneLayout)
// ═══════════════════════════════════════════════════════════

interface InnerEdges { left: boolean; right: boolean; top: boolean; bottom: boolean; }

/** Terminal sessions render the same reference canvas as every other container. */
function PaneLayout({ layout, windowId, focusedTermId, active, setRatioNode }: {
  layout: WindowLayout; windowId: string; focusedTermId: string; active: boolean;
  setRatioNode: (aId: string, bId: string, ratio: number) => void;
}) {
  const resources = useWorkspaceResources();
  const canonical = useWorkspaceContainer('terminal', windowId);
  const controls = useWorkspacePaneControls('terminal');
  return <WorkspacePaneCanvas containerId={windowId} splitScope="terminal" layout={canonical?.layout ?? terminalWorkspaceLayout(layout)} focused={focusedTermId} resources={resources} visible={active} retainHeader
    dividerTestPrefix="terminal-divider" onFocus={id => useTerminalStore.getState().setFocusedPane(id.slice('terminal:'.length))}
    placing={active && !!controls.pendingMergeTab} onRatio={setRatioNode} onPlace={target => {
      if (controls.pendingMergeTab) void mergeWorkspaceContainers(controls.pendingMergeTab, windowId, target);
      controls.chooseMerge();
    }} onCancel={() => controls.chooseMerge()}
    onSplit={(id, kind) => requestWorkspaceSplit(id, undefined, kind)}
    onMovePane={(paneId, target) => moveWorkspacePane(windowId, paneId, target)}
    onRemove={id => closeTerminalPane(id.slice('terminal:'.length))} onDetach={id => detachWorkspacePane('terminal', id)}
    />;
}

// ═══════════════════════════════════════════════════════════
// Divider (drag to adjust the ratio)
// ═══════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════
// Terminal pane
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
  placed?: boolean;
}) {
  const { terminal, windowId, focused, setSession, setFocusedPane, onContextMenu, inner, reorderable, placed } = props;
  const commandDraft = useInputStore(state => state.byPane[terminal.id]?.text ?? '');
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
  const area = useWorkspaceNavigation(state => state.area);
  const terminalArea = area === 'terminal' || area === 'unified';
  const scene = useTerminalStore((s) => s.scenes[terminal.id] ?? 'classic');
  const sessionId = useTerminalStore((s) => s.sessions[terminal.id]);
  const [enteredBlockMode, setEnteredBlockMode] = useState(false);
  useEffect(() => { setEnteredBlockMode(false); }, [terminal.ssh?.connectionId, terminal.ssh?.host, terminal.openMode]);
  useEffect(() => { if (scene === 'blockList') setEnteredBlockMode(true); }, [scene]);
  const manualFullscreen = useTerminalStore(s => !!s.manualFullscreen[terminal.id]);
  const fullscreenVisible = useManualFullscreenVisible(terminal.id);
  const hasExecutingBlock = useBlockStore(state => (state.byTab[terminal.id] ?? []).some(block => block.status === 'executing'));
  useTerminalFocus(focused && scene === 'blockList' && hasExecutingBlock, terminal.id);
  useLayoutEffect(() => {
    if (!focused) return;
    focusSessionInput(terminal.id);
    const frame = requestAnimationFrame(() => focusSessionInput(terminal.id));
    return () => cancelAnimationFrame(frame);
  }, [focused, terminal.id, scene, hasExecutingBlock, sessionId]);
  // An SSH pane's classic scene is its connection/auth surface; the pane's chat
  // history stays out of the way so that surface owns the pane.
  const showChatHistory = showsPaneChatHistory(scene, terminal.kind);
  // Real alternate buffers use the main xterm; manual fullscreen uses the live block terminal.
  const disconnectedBlock = terminal.kind === 'ssh' && terminal.openMode === 'block' && enteredBlockMode && sshState.phase === 'disconnected';
  const showXterm = !disconnectedBlock && (scene === 'classic' || (scene === 'altScreen' && !manualFullscreen));
  const showBlocks = scene === 'blockList' || disconnectedBlock || (manualFullscreen && !fullscreenVisible);
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
      {(showBlocks || (scene === 'classic' && commandDraft.length > 0)) && (
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
      {scene === 'altScreen' && !manualFullscreen && <TuiBanner tabId={terminal.id} />}
    </div>
  );

  return (
    <SplitPaneSurface inner={inner}
      data-testid={`pane-${terminal.id}`}
      className="terminal-pane"
      data-focused={focused ? 'true' : 'false'}
      onClick={() => setFocusedPane(terminal.id)}
      onMouseDown={onPaneMouseDown}
      onContextMenu={(e) => {
        if (useSessionStore.getState().activeId !== windowId) useSessionStore.getState().activate(windowId);
        setFocusedPane(terminal.id);
        onContextMenu(e, sshActions);
      }}
    >
      {terminal.kind === 'ssh' && terminal.ssh ? <SshStatusPanel
        key={`${terminal.ssh.connectionId ?? ''}:${terminal.ssh.host}:${terminal.ssh.port ?? 22}`}
        paneId={terminal.id} target={terminal.ssh} state={sshState} active={terminalArea && activeTabId === windowId} focused={focused}
        width={sshStatusWidth} onWidthChange={setSshStatusWidth}
        onToolbarReady={setSshToolbarHost} compact={blockPresentation}
        statusTrigger={sshStatusTrigger} openRequest={sshStatusOpenRequest}
        toggleRequest={sshStatusToggleRequest} onOpenChange={setSshPanelOpen}
        onReconnect={reconnectSsh}
      >{paneContent}</SshStatusPanel> : paneContent}
      {placed && area === 'unified' && fullscreenVisible && (
        <div data-testid="tui-fullscreen" data-pane-id={terminal.id}
          onContextMenu={(event) => {
            event.preventDefault(); event.stopPropagation();
            if (useSessionStore.getState().activeId !== windowId) useSessionStore.getState().activate(windowId);
            setFocusedPane(terminal.id);
            onContextMenu(event, sshActions);
          }}
          style={{ position: 'absolute', inset: 0, zIndex: 100, background: 'var(--xterm-bg)', paddingTop: 28 }}>
          <TuiBanner tabId={terminal.id} />
        </div>
      )}
    </SplitPaneSurface>
  );
}

// TuiBanner (alternate-screen programs)

function TuiBanner({ tabId }: { tabId: string }) {
  const {
    manualFullscreen,
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
          {manualFullscreen && <StatusActionButton title={t('Exit fullscreen')} onClick={exitFullScreen} label={<Minimize2 size={STATUS_ACTION_ICON_SIZE} />} />}
        </>}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// PaneInputEditor (the terminal pane's dedicated input bar)

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
      {pinned && pinnedBlock && <PinnedCommand block={pinnedBlock} paneId={paneId}
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
      <div style={{ color: 'var(--text-primary)', fontSize: 'calc(15px * var(--ui-font-scale))', fontWeight: 'var(--fw-medium)' }}>{t('Start with a command')}</div>
      <div style={{ fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--text-secondary)' }}>{t('Type a command below, or open the AI assistant in the top right.')}</div>
    </div>
  );
}
