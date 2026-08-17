/**
 * TerminalView — 终端主表面，scene store 驱动（对应文档 §1、§6）。
 *
 *   三路派发改为 scene 驱动：
 *     - loading: 无 session
 *     - blockList: block 列表（普通 DOM 滚动 + follow-bottom）
 *     - classic / altScreen: 主 xterm 表面
 *
 *   停靠布局（terminalLayout）：终端区域最多 2×2 停靠 4 个终端。
 *   拖拽标签到终端区域时显示 4 象限预停靠高亮，松手停靠到对应槽位。
 */

import { useRef, useEffect, useMemo, useCallback, useState } from 'react';
import { useWorkspaceStore } from '../stores/workspace';
import { useTerminalStore } from '../stores/terminal';
import { useTerminalLayoutStore, gridDimensions, gridPosition } from '../stores/terminalLayout';
import { useDockDragStore } from '../stores/dockDrag';
import { useActiveMessages } from '../stores/chat';
import { useBlockStore, selectBlocks } from '../stores/blocks';
import { ptyWrite } from '../lib/pty';
import { killForeground, ESCALATE_WINDOW_MS } from '../lib/killForeground';
import { useToastStore } from '../components/Toast';
import { useFollowBottom, registerFollowEngager, engageFollow } from './useFollowBottom';
import { useTerminalFocus } from './useTerminalFocus';
import InputEditor from './InputEditor';
import InlineAI from './InlineAI';
import TerminalBlockList, { hasVisibleContent } from './TerminalBlockList';
import TerminalPanel from './TerminalPanel';
import SessionHistoryView from '../components/SessionHistoryView';
import SettingsView from '../settings/SettingsView';

/** TuiBanner 高度（含 1px border）：真实 alt-buffer 应用（vim/htop）与手动全屏时，
 *  终端表面需向下偏移这么多，避免顶部第一行被 banner 遮挡。 */
const TUI_BANNER_HEIGHT = 28;

export default function TerminalView() {
  const tabs = useWorkspaceStore((s) => s.tabs);
  const activeId = useWorkspaceStore((s) => s.activeId);
  const activate = useWorkspaceStore((s) => s.activate);
  const setSession = useTerminalStore((s) => s.setSession);
  const sessions = useTerminalStore((s) => s.sessions);
  const altScreenActive = useTerminalStore((s) => s.altScreenActive);
  const messages = useActiveMessages();
  const blocks = useBlockStore(selectBlocks(activeId));
  const scrollRef = useRef<HTMLDivElement>(null);
  const aiMessagesEnd = useRef<HTMLDivElement>(null);
  const zoneRef = useRef<HTMLDivElement>(null);

  // 聚焦 tab（网格里即 activeId）
  const scene = useTerminalStore((s) => s.scenes[activeId] ?? 'classic');
  const hasSession = !!sessions[activeId];
  const manualTui = scene === 'altScreen' && altScreenActive;

  const hasRunningBlock = blocks.some((b) => b.status === 'executing' && b.wasLongRunning);
  const runningCommand =
    [...blocks].reverse().find((b) => b.status === 'executing')?.command ?? '';

  const snapMain = useFollowBottom(scrollRef, [blocks]);
  useEffect(() => registerFollowEngager(activeId, snapMain), [activeId, snapMain]);

  const [bootGrace, setBootGrace] = useState(true);
  useEffect(() => {
    if (scene !== 'classic') {
      setBootGrace(false);
      return;
    }
    const t = setTimeout(() => setBootGrace(false), 1500);
    return () => clearTimeout(t);
  }, [scene]);

  const hasExecutingBlock = blocks.some((b) => b.status === 'executing');
  useTerminalFocus(scene === 'blockList' && hasExecutingBlock, activeId);

  useEffect(() => {
    if (manualTui && !hasExecutingBlock) {
      useTerminalStore.getState().setAltScreenActive(false);
      useTerminalStore.getState().setScene(activeId, 'blockList');
    }
  }, [manualTui, hasExecutingBlock, activeId]);

  useEffect(() => {
    aiMessagesEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, messages[messages.length - 1]?.content.length]);

  const activeTab = tabs.find((t) => t.id === activeId);
  const isHistoryTab = activeTab?.kind === 'history';
  const isSettingsTab = activeTab?.kind === 'settings';
  const isNonTerminalTab = isHistoryTab || isSettingsTab;
  const terminalTabs = tabs.filter((t) => t.kind === 'local' || t.kind === 'ssh');

  // ── 停靠布局 ──
  const slots = useTerminalLayoutStore((s) => s.slots);
  const dockedTabs = useMemo(() => {
    const list: { id: string; slot: number }[] = [];
    for (const t of terminalTabs) {
      const idx = slots.indexOf(t.id);
      if (idx >= 0) list.push({ id: t.id, slot: idx });
    }
    list.sort((a, b) => a.slot - b.slot);
    return list;
  }, [terminalTabs, slots]);
  // ≥2 个停靠标签才进入网格（单标签保持原单表面布局，向后兼容）
  const isGrid = dockedTabs.length >= 2 && !isNonTerminalTab;

  // ── 拖拽预停靠高亮 ──
  const draggingTabId = useDockDragStore((s) => s.draggingTabId);
  const hoveredSlot = useDockDragStore((s) => s.hoveredSlot);
  const setHoveredSlot = useDockDragStore((s) => s.setHoveredSlot);

  useEffect(() => {
    if (!draggingTabId) return;
    const el = zoneRef.current;
    if (!el) return;
    const onMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const x = e.clientX;
      const y = e.clientY;
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
        setHoveredSlot(null);
        return;
      }
      const relX = (x - rect.left) / rect.width;
      const relY = (y - rect.top) / rect.height;
      const col = relX < 0.5 ? 0 : 1;
      const row = relY < 0.5 ? 0 : 1;
      setHoveredSlot(row * 2 + col);
    };
    document.addEventListener('mousemove', onMove);
    return () => document.removeEventListener('mousemove', onMove);
  }, [draggingTabId, setHoveredSlot]);

  // 网格几何
  const dims = useMemo(() => gridDimensions(slots), [slots]);
  const positions = useMemo(() => gridPosition(slots), [slots]);

  return (
    <div
      ref={zoneRef}
      data-terminal-dock-zone
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
      }}
    >
      {isNonTerminalTab ? (
        isHistoryTab ? <SessionHistoryView /> : <SettingsView />
      ) : isGrid ? (
        <GridSurface
          dockedTabs={dockedTabs}
          terminalTabs={terminalTabs}
          positions={positions}
          dims={dims}
          activeId={activeId}
          setSession={setSession}
          activate={activate}
          dragging={!!draggingTabId}
          hoveredSlot={hoveredSlot}
        />
      ) : (
        <SingleSurface
          terminalTabs={terminalTabs}
          activeId={activeId}
          setSession={setSession}
          scene={scene}
          hasSession={hasSession}
          bootGrace={bootGrace}
          messages={messages}
          aiMessagesEnd={aiMessagesEnd}
          scrollRef={scrollRef}
          hasRunningBlock={hasRunningBlock}
          runningCommand={runningCommand}
        />
      )}

      {/* 拖拽预停靠高亮（覆盖整个终端区域） */}
      {draggingTabId && <DropZones hoveredSlot={hoveredSlot} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// 网格表面（≥1 停靠标签）
// ═══════════════════════════════════════════════════════════

function GridSurface(props: {
  dockedTabs: { id: string; slot: number }[];
  terminalTabs: { id: string; kind: string }[];
  positions: { row: number; col: number }[];
  dims: { rows: number; cols: number };
  activeId: string;
  setSession: (tabId: string, sessionId: string) => void;
  activate: (id: string) => void;
  dragging: boolean;
  hoveredSlot: number | null;
}) {
  const { dockedTabs, terminalTabs, positions, dims, activeId } = props;
  const dockedIds = new Set(dockedTabs.map((d) => d.id));
  const messages = useActiveMessages();
  const aiMessagesEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    aiMessagesEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, messages[messages.length - 1]?.content.length]);

  return (
    <>
      <div style={{ flex: 1, minHeight: 0, position: 'relative', background: 'var(--surface)' }}>
        {/* 非停靠会话标签：隐藏但保持挂载，PTY 保活 */}
        {terminalTabs.filter((t) => !dockedIds.has(t.id)).map((t) => (
          <div key={t.id} style={{ position: 'absolute', inset: 0, display: 'none' }}>
            <TerminalPanel paneId={t.id} tabId={t.id} onReady={(sid) => props.setSession(t.id, sid)} />
          </div>
        ))}

        {/* 网格 */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            gridTemplateRows: `repeat(${Math.max(1, dims.rows)}, 1fr)`,
            gridTemplateColumns: `repeat(${Math.max(1, dims.cols)}, 1fr)`,
            gap: 6,
            padding: 6,
          }}
        >
          {dockedTabs.map(({ id, slot }) => {
            const pos = positions[slot] ?? { row: 0, col: 0 };
            const focused = id === activeId;
            return (
              <div
                key={id}
                data-testid={`pane-${id}`}
                data-focused={focused ? 'true' : 'false'}
                onClick={() => props.activate(id)}
                style={{
                  gridRow: pos.row + 1,
                  gridColumn: pos.col + 1,
                  minWidth: 0,
                  minHeight: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  position: 'relative',
                  background: 'var(--surface)',
                  border: `1px solid ${focused ? 'var(--border-strong)' : 'var(--border)'}`,
                  borderRadius: 8,
                  overflow: 'hidden',
                }}
              >
                <div style={{ position: 'absolute', inset: 0, opacity: 0, pointerEvents: 'none' }}>
                  <TerminalPanel paneId={id} tabId={id} onReady={(sid) => props.setSession(id, sid)} />
                </div>
                <PaneBlockList paneId={id} />
                <PaneInputEditor paneId={id} />
              </div>
            );
          })}
        </div>
      </div>

      {/* InlineAI（聚焦标签的 AI 对话，全局显示在网格下方） */}
      <div
        style={{
          maxHeight: messages.length > 0 ? '35%' : '0px',
          overflow: 'hidden',
          flexShrink: 0,
          borderBottom: messages.length > 0 ? '1px solid var(--border)' : 'none',
          background: 'var(--surface)',
          transition: 'max-height 0.25s ease, border 0.25s ease',
        }}
      >
        {messages.length > 0 && (
          <>
            <InlineAI />
            <div ref={aiMessagesEnd} />
          </>
        )}
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════
// 单表面（网格空时的回退）
// ═══════════════════════════════════════════════════════════

function SingleSurface(props: {
  terminalTabs: { id: string; kind: string }[];
  activeId: string;
  setSession: (tabId: string, sessionId: string) => void;
  scene: string;
  hasSession: boolean;
  bootGrace: boolean;
  messages: unknown[];
  aiMessagesEnd: React.RefObject<HTMLDivElement | null>;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  hasRunningBlock: boolean;
  runningCommand: string;
}) {
  const {
    terminalTabs, activeId, setSession, scene, hasSession, bootGrace,
    messages, aiMessagesEnd, scrollRef, hasRunningBlock, runningCommand,
  } = props;

  const altScreenActive = useTerminalStore((s) => s.altScreenActive);
  const manualTui = scene === 'altScreen' && altScreenActive;

  const showLoading = !hasSession || bootGrace;
  const showBlocks = hasSession && scene === 'blockList';

  const xtermContainerStyle: React.CSSProperties =
    scene === 'altScreen' && !manualTui
      ? { position: 'absolute', top: TUI_BANNER_HEIGHT, right: 0, bottom: 0, left: 0, zIndex: 100 }
      : hasSession && scene === 'classic' && !bootGrace
        ? { flex: 1, minHeight: 0, position: 'relative' }
        : { position: 'absolute', inset: 0, opacity: 0, pointerEvents: 'none' };

  return (
    <>
      <div style={xtermContainerStyle}>
        {terminalTabs.map((t) => (
          <div
            key={t.id}
            style={{ position: 'absolute', inset: 0, display: t.id === activeId ? 'block' : 'none' }}
          >
            <TerminalPanel paneId={t.id} tabId={t.id} onReady={(sid) => setSession(t.id, sid)} />
          </div>
        ))}
      </div>

      <div
        style={{
          maxHeight: messages.length > 0 && scene !== 'altScreen' ? '35%' : '0px',
          overflow: 'hidden',
          flexShrink: 0,
          borderBottom: messages.length > 0 && scene !== 'altScreen' ? '1px solid var(--border)' : 'none',
          background: 'var(--surface)',
          transition: 'max-height 0.25s ease, border 0.25s ease',
        }}
      >
        {messages.length > 0 && (
          <>
            <InlineAI />
            <div ref={aiMessagesEnd} />
          </>
        )}
      </div>

      {showLoading && <LoadingState />}

      <div
        ref={scrollRef}
        style={{
          display: showBlocks ? undefined : 'none',
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          background: 'var(--surface)',
        }}
      >
        <div style={{ paddingBottom: 8 }}>
          <TerminalBlockList tabId={activeId} />
          <EmptyState tabId={activeId} />
        </div>
      </div>

      {manualTui && (
        <div
          data-testid="tui-fullscreen"
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 100,
            background: 'var(--canvas)',
            padding: `${TUI_BANNER_HEIGHT}px 8px 8px`,
          }}
        />
      )}

      {scene === 'altScreen' && <TuiBanner tabId={activeId} />}

      <InputEditor
        paneId={activeId}
        isLongRunning={hasRunningBlock}
        runningCommand={runningCommand}
        forceHidden={scene === 'classic'}
        onEndPress={() => {
          engageFollow(activeId);
          useTerminalStore.getState().setKeyboardTarget('input');
        }}
      />
    </>
  );
}

// ═══════════════════════════════════════════════════════════
// 拖拽预停靠高亮（4 象限）
// ═══════════════════════════════════════════════════════════

function DropZones({ hoveredSlot }: { hoveredSlot: number | null }) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 60,
        pointerEvents: 'none',
        display: 'grid',
        gridTemplateRows: '1fr 1fr',
        gridTemplateColumns: '1fr 1fr',
        gap: 6,
        padding: 6,
      }}
    >
      {[0, 1, 2, 3].map((slot) => (
        <div
          key={slot}
          data-testid={`drop-zone-${slot}`}
          style={{
            borderRadius: 8,
            border: hoveredSlot === slot ? '1px solid var(--accent)' : '1px dashed var(--border-strong)',
            background: hoveredSlot === slot ? 'var(--accent-bg)' : 'rgba(128,128,128,0.06)',
            transition: 'background 0.08s ease, border-color 0.08s ease',
          }}
        />
      ))}
    </div>
  );
}

// ── TuiBanner ──

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
    killForeground(sid)
      .then((level) => {
        if (killTimer.current) clearTimeout(killTimer.current);
        if (level === 'term') {
          setKillArmed(true);
          killTimer.current = setTimeout(() => setKillArmed(false), ESCALATE_WINDOW_MS);
        } else {
          setKillArmed(false);
        }
      })
      .catch((e) => {
        useToastStore.getState().addToast(String((e as Error)?.message ?? e), 'info');
      });
  }, [sessions, tabId]);

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 101,
        padding: '4px 12px',
        fontSize: 11,
        fontFamily: 'var(--font-mono)',
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        color: 'var(--text-secondary)',
        backdropFilter: 'blur(4px)',
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
      <span style={{ color: 'var(--text-secondary)' }}>
        TUI{runningCommand ? ` · ${runningCommand}` : ''}
      </span>
      <div style={{ flex: 1 }} />
      <span
        onClick={sendCtrlC}
        title="发送 Ctrl+C"
        style={{
          fontSize: 10,
          padding: '1px 6px',
          border: '1px solid var(--border)',
          borderRadius: 3,
          cursor: 'pointer',
          fontFamily: 'var(--font-mono)',
          color: 'var(--text-secondary)',
        }}
      >
        ^C
      </span>
      <span
        onClick={killApp}
        title={killArmed ? '再次点击发送 SIGKILL（强杀，应用无清理机会）' : '结束前台应用 (SIGTERM)；3 秒内再点升级 SIGKILL'}
        style={{
          fontSize: 10,
          padding: '1px 6px',
          border: `1px solid ${killArmed ? 'var(--accent-warm)' : 'var(--border)'}`,
          borderRadius: 3,
          cursor: 'pointer',
          fontFamily: 'var(--font-mono)',
          color: killArmed ? 'var(--accent-warm)' : 'var(--text-secondary)',
        }}
      >
        {killArmed ? '强杀!' : '结束'}
      </span>
      {altScreenActive && (
        <span
          onClick={() => {
            setAltScreenActive(false);
            setScene(tabId, 'blockList');
          }}
          title="退出全屏"
          style={{
            fontSize: 10,
            padding: '1px 6px',
            border: '1px solid var(--border)',
            borderRadius: 3,
            cursor: 'pointer',
            fontFamily: 'var(--font-mono)',
            color: 'var(--text-secondary)',
          }}
        >
          esc
        </span>
      )}
    </div>
  );
}

// ── LoadingState（§6 场景 0：PTY 连接中） ──

function LoadingState() {
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--canvas)',
        color: 'var(--text-muted)',
        fontSize: 13,
        userSelect: 'none',
        gap: 10,
      }}
    >
      <div
        style={{
          width: 24,
          height: 24,
          borderRadius: '50%',
          border: '2px solid var(--border)',
          borderTopColor: 'var(--accent)',
          animation: 'spin 0.8s linear infinite',
        }}
      />
      <div style={{ color: 'var(--text-secondary)' }}>正在启动 Shell…</div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ── PaneInputEditor（网格 pane 的独立输入栏） ──

function PaneInputEditor({ paneId }: { paneId: string }) {
  const blocks = useBlockStore(selectBlocks(paneId));
  const hasRunningBlock = blocks.some((b) => b.status === 'executing' && b.wasLongRunning);
  const runningCommand =
    [...blocks].reverse().find((b) => b.status === 'executing')?.command ?? '';

  return (
    <InputEditor
      paneId={paneId}
      isLongRunning={hasRunningBlock}
      runningCommand={runningCommand}
      onEndPress={() => {
        engageFollow(paneId);
        useTerminalStore.getState().setKeyboardTarget('input');
      }}
    />
  );
}

// ── PaneBlockList / PaneEmptyHint（网格 pane） ──

function PaneBlockList({ paneId }: { paneId: string }) {
  const blocks = useBlockStore(selectBlocks(paneId));
  const scrollRef = useRef<HTMLDivElement>(null);
  const snap = useFollowBottom(scrollRef, [blocks]);

  useEffect(() => registerFollowEngager(paneId, snap), [paneId, snap]);

  return (
    <div
      ref={scrollRef}
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        background: 'var(--surface)',
      }}
    >
      <div style={{ paddingBottom: 8 }}>
        <TerminalBlockList tabId={paneId} />
        <PaneEmptyHint paneId={paneId} />
      </div>
    </div>
  );
}

function PaneEmptyHint({ paneId }: { paneId: string }) {
  const blocks = useBlockStore(selectBlocks(paneId));
  if (blocks.some(hasVisibleContent)) return null;
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        paddingTop: '8vh',
        color: 'var(--text-muted)',
        fontSize: 12,
        userSelect: 'none',
        gap: 6,
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 18,
          color: 'var(--text-muted)',
          opacity: 0.25,
          fontWeight: 600,
          marginBottom: 6,
        }}
      >
        $
      </div>
      <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>在下方输入命令</div>
      <div
        style={{
          fontSize: 11,
          color: 'var(--text-muted)',
          opacity: 0.6,
          fontFamily: 'var(--font-mono)',
        }}
      >
        Enter 执行 · Shift+Enter 换行
      </div>
    </div>
  );
}

// ── EmptyState ──

function EmptyState({ tabId }: { tabId: string }) {
  const blocks = useBlockStore(selectBlocks(tabId));
  const messages = useActiveMessages();
  if (blocks.some(hasVisibleContent) || messages.length > 0) return null;
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        paddingTop: '12vh',
        color: 'var(--text-muted)',
        fontSize: 13,
        userSelect: 'none',
        gap: 6,
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 18,
          color: 'var(--text-muted)',
          opacity: 0.25,
          fontWeight: 600,
          marginBottom: 6,
        }}
      >
        $
      </div>
      <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>在下方输入命令</div>
      <div
        style={{
          fontSize: 11,
          color: 'var(--text-muted)',
          opacity: 0.6,
          fontFamily: 'var(--font-mono)',
        }}
      >
        Enter 执行 · Shift+Enter 换行
      </div>
    </div>
  );
}
