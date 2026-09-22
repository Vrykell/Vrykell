import { useRef, useState, useEffect, useCallback } from 'react';
import { Settings, Search } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useDockStore, PANEL_DEFS, type DockSide } from '@features/workspace';
import DockButton from '@features/workspace/components/DockButton';
import WindowControls from '@features/workspace/components/WindowControls';
import { ToolbarBtn } from '@ui/UiBtn';
import { useUiStore } from '@features/workspace';
import { selectActiveSessionTab, useSessionStore } from '@features/workspace';
import { isMacOS } from '@platform/runtime';

/** 按 clientX 判定落在哪个 zone */
function hitZone(
  leftEl: HTMLElement | null,
  rightEl: HTMLElement | null,
  clientX: number,
): DockSide | null {
  if (rightEl) {
    const r = rightEl.getBoundingClientRect();
    if (clientX >= r.left) return 'right';
  }
  if (leftEl) {
    const l = leftEl.getBoundingClientRect();
    if (clientX <= l.right) return 'left';
  }
  if (leftEl && rightEl) {
    const lr = leftEl.getBoundingClientRect().right;
    const rl = rightEl.getBoundingClientRect().left;
    return (clientX - lr < rl - clientX) ? 'left' : 'right';
  }
  return null;
}

/** 计算在指定 zone 内的插入索引 */
function insertIndex(zoneEl: HTMLElement, dragId: string, clientX: number): number {
  const btns = zoneEl.querySelectorAll<HTMLElement>('[data-dock-btn]');
  let idx = 0;
  for (let i = 0; i < btns.length; i++) {
    const b = btns[i]!;
    if (b.dataset.dockBtn === dragId) continue;
    const r = b.getBoundingClientRect();
    if (clientX < r.left + r.width / 2) return idx;
    idx++;
  }
  return idx;
}

interface DragInfo { btnId: string; zone: DockSide; startX: number }
interface DropTarget { zone: DockSide; index: number }

const DRAG_THRESHOLD = 3;
const BAR_H = 40; // 顶栏整体高度

export default function TopDock() {
  const leftZone = useDockStore((s) => s.leftZone);
  const rightZone = useDockStore((s) => s.rightZone);
  const leftPanels = useDockStore((s) => s.leftPanels);
  const rightPanels = useDockStore((s) => s.rightPanels);
  const moveButton = useDockStore((s) => s.moveButton);
  const togglePanel = useDockStore((s) => s.togglePanel);
  // AI 面板与终端强相关：非会话标签（设置/历史）时隐藏「AI 进入按钮」。
  // 这里是条件按钮的统一钩子——以后需要选择性显隐的按钮都从这里过滤。
  const isSessionActive = useSessionStore((state) => selectActiveSessionTab(state) !== null);

  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [dragCursor, setDragCursor] = useState<{ x: number; y: number } | null>(null);
  // macOS 全屏时红绿灯自动隐藏，无需再预留左侧空间
  const [fullscreen, setFullscreen] = useState(false);
  const dragRef = useRef<DragInfo | null>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isMacOS) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let win: { isFullscreen: () => Promise<boolean>; onResized: (cb: () => void) => Promise<() => void> } | null = null;
    try {
      win = getCurrentWindow();
    } catch {
      return; // 浏览器/非 Tauri 环境无 window API
    }
    const sync = async () => {
      try {
        const fs = await win!.isFullscreen();
        if (!disposed) setFullscreen(!!fs);
      } catch {
        // 忽略
      }
    };
    sync();
    win.onResized(() => sync())
      .then((fn) => { unlisten = fn; })
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const handleBtnMouseDown = useCallback((e: React.MouseEvent, btnId: string) => {
    const zone: DockSide = leftZone.includes(btnId) ? 'left' : 'right';
    dragRef.current = { btnId, zone, startX: e.clientX };
  }, [leftZone]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const info = dragRef.current;
      if (!info) return;

      if (Math.abs(e.clientX - info.startX) < DRAG_THRESHOLD) {
        setDropTarget(null);
        return;
      }

      document.body.style.cursor = 'grabbing';
      document.body.style.userSelect = 'none';
      setDragCursor({ x: e.clientX, y: e.clientY });

      const zone = hitZone(leftRef.current, rightRef.current, e.clientX);
      if (!zone) return;
      const el = zone === 'left' ? leftRef.current : rightRef.current;
      if (!el) return;

      const idx = insertIndex(el, info.btnId, e.clientX);
      setDropTarget({ zone, index: idx });
    };

    const onUp = (e: MouseEvent) => {
      const info = dragRef.current;
      if (!info) return;

      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setDragCursor(null);

      if (Math.abs(e.clientX - info.startX) < DRAG_THRESHOLD) {
        togglePanel(info.zone, info.btnId);
      } else {
        const zone = hitZone(leftRef.current, rightRef.current, e.clientX);
        if (zone) {
          const el = zone === 'left' ? leftRef.current : rightRef.current;
          if (el) {
            const idx = insertIndex(el, info.btnId, e.clientX);
            moveButton(info.btnId, zone, idx);
          }
        }
      }

      dragRef.current = null;
      setDropTarget(null);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [togglePanel, moveButton]);

  function renderZone(zone: DockSide, ids: string[], activePanels: string[]) {
    const ref = zone === 'left' ? leftRef : rightRef;
    const show = dropTarget?.zone === zone;
    // 条件按钮：非会话标签时隐藏 AI 入口（其它常驻按钮不受影响）
    const visibleIds = ids.filter((id) => id !== 'chat' || isSessionActive);

    return (
      <div ref={ref} style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '0 4px', borderRadius: 5 }}>
        {visibleIds.map((id, i) => (
          <span key={id} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            {show && dropTarget!.index === i && <DropMarker />}
            <DockButton
              panelId={id}
              active={activePanels.includes(id)}
              onMouseDown={handleBtnMouseDown}
            />
          </span>
        ))}
        {show && dropTarget!.index >= visibleIds.length && <DropMarker />}
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', height: BAR_H, flexShrink: 0,
      background: 'var(--surface)', borderBottom: '1px solid var(--block-divider)',
      paddingRight: 6, userSelect: 'none',
      position: 'relative',
    }}>
      {/* 左侧窗口拖拽区 — macOS 红绿灯保留空间（全屏时红绿灯隐藏，无需预留；Windows 无需预留） */}
      <div data-tauri-drag-region style={{ width: isMacOS && !fullscreen ? 78 : 0, height: BAR_H, flexShrink: 0 }} />
      {renderZone('left', leftZone, leftPanels)}
      {/* 全局搜索触发器 — 绝对居中，点击打开居中搜索窗 */}
      <button
        data-testid="global-search-trigger"
        onClick={() => useUiStore.getState().setGlobalSearchOpen(true)}
        style={{
          position: 'absolute', left: '50%', transform: 'translateX(-50%)',
          display: 'flex', alignItems: 'center', gap: 6,
          background: 'var(--block)', border: 'none',
          borderRadius: 6, padding: '0 10px', height: 28, width: 360, maxWidth: '44vw',
          color: 'var(--text-muted)', cursor: 'pointer',
          fontSize: 12, fontFamily: 'var(--font-ui)', textAlign: 'left',
        }}
      >
        <Search size={11} style={{ flexShrink: 0 }} />
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          搜索文件、命令、设置…
        </span>
      </button>
      {/* 中间窗口拖拽区 */}
      <div data-tauri-drag-region style={{ flex: 1, height: BAR_H }} />
      {renderZone('right', rightZone, rightPanels)}
      <ToolbarBtn title="设置（⌘,）" onClick={() => useSessionStore.getState().openSettingsTab()}>
        <Settings size={16} />
      </ToolbarBtn>
      <WindowControls />

      {/* 拖拽跟随光标预览 */}
      {dragCursor && dragRef.current && (
        <DragPreview
          btnId={dragRef.current.btnId}
          x={dragCursor.x}
          y={dragCursor.y}
        />
      )}
    </div>
  );
}

/** 拖拽插入标记 — 醒目的蓝色光标线 + 两侧间距 */
function DropMarker() {
  return (
    <div style={{
      width: 4, height: 20, borderRadius: 2, flexShrink: 0,
      background: 'var(--accent)',
      boxShadow: '0 0 6px 2px rgba(255,255,255,0.45)',
      margin: '0 3px',
    }} />
  );
}

/** 拖拽时光标旁的浮动按钮预览 */
function DragPreview({ btnId, x, y }: { btnId: string; x: number; y: number }) {
  const def = PANEL_DEFS[btnId];
  if (!def) return null;
  const Icon = def.icon;

  return (
    <div style={{
      position: 'fixed', left: x, top: y,
      width: 24, height: 24,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      lineHeight: 1,
      borderRadius: 5,
      background: 'var(--elevated)',
      border: '1px solid var(--border-strong)',
      color: 'var(--text-primary)',
      boxShadow: '0 4px 12px rgba(0,0,0,0.4), 0 0 8px rgba(255,255,255,0.25)',
      transform: 'translate(8px, 8px)',  // 稍微偏移，不遮挡光标
      pointerEvents: 'none',
      zIndex: 9999,
      opacity: 0.92,
    }}>
      <Icon size={14} />
    </div>
  );
}
