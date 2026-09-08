import { getCurrentWindow } from '@tauri-apps/api/window';
import { Search, Settings, Terminal } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import DockButton from '@/components/layout/TopDock/DockButton';
import { ToolbarBtn } from '@/components/ui/Button/Button';
import { isMacOS } from '@/services/tauri/platform';
import { type DockSide, PANEL_DEFS, useDockStore } from '@/store/dock';
import { useUiStore } from '@/store/ui';
import { isSessionTab, useWorkspaceStore } from '@/store/workspace';
import s from './TopDock.module.css';

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
    return clientX - lr < rl - clientX ? 'left' : 'right';
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

interface DragInfo {
  btnId: string;
  zone: DockSide;
  startX: number;
}
interface DropTarget {
  zone: DockSide;
  index: number;
}

const DRAG_THRESHOLD = 3;

export default function TopDock() {
  const leftZone = useDockStore((s) => s.leftZone);
  const rightZone = useDockStore((s) => s.rightZone);
  const leftPanels = useDockStore((s) => s.leftPanels);
  const rightPanels = useDockStore((s) => s.rightPanels);
  const moveButton = useDockStore((s) => s.moveButton);
  const togglePanel = useDockStore((s) => s.togglePanel);
  const isSessionActive = useWorkspaceStore((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeId);
    return !!tab && isSessionTab(tab);
  });

  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [dragCursor, setDragCursor] = useState<{ x: number; y: number } | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const dragRef = useRef<DragInfo | null>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isMacOS) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let win: {
      isFullscreen: () => Promise<boolean>;
      onResized: (cb: () => void) => Promise<() => void>;
    } | null = null;
    try {
      win = getCurrentWindow();
    } catch {
      return;
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
    win
      .onResized(() => sync())
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const handleBtnMouseDown = useCallback(
    (e: React.MouseEvent, btnId: string) => {
      const zone: DockSide = leftZone.includes(btnId) ? 'left' : 'right';
      dragRef.current = { btnId, zone, startX: e.clientX };
    },
    [leftZone],
  );

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
    const visibleIds = ids.filter((id) => id !== 'chat' || isSessionActive);

    return (
      <div ref={ref} className={s.zone}>
        {visibleIds.map((id, i) => (
          <span key={id} className={s.btnGroup}>
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
    <div className={s.bar}>
      {/* 左侧窗口拖拽区 — macOS 红绿灯保留空间 */}
      <div
        data-tauri-drag-region
        className={s.dragRegion}
        style={{ width: isMacOS && !fullscreen ? 78 : 0 }}
      />
      {renderZone('left', leftZone, leftPanels)}
      {/* 全局搜索触发器 */}
      <button
        data-testid="global-search-trigger"
        onClick={() => useUiStore.getState().setGlobalSearchOpen(true)}
        className={s.searchTrigger}
      >
        <Search size={11} style={{ flexShrink: 0 }} />
        <span className={s.searchText}>搜索文件、命令、设置…</span>
      </button>
      {/* 中间窗口拖拽区 */}
      <div data-tauri-drag-region className={s.centerDrag} />
      {renderZone('right', rightZone, rightPanels)}
      <ToolbarBtn title="设置（⌘,）" onClick={() => useWorkspaceStore.getState().openSettingsTab()}>
        <Settings size={16} />
      </ToolbarBtn>
      <span className={s.brand}>
        <Terminal size={11} /> Vrykell
      </span>

      {/* 拖拽跟随光标预览 */}
      {dragCursor && dragRef.current && (
        <DragPreview btnId={dragRef.current.btnId} x={dragCursor.x} y={dragCursor.y} />
      )}
    </div>
  );
}

/** 拖拽插入标记 — 醒目的光标线 + 两侧间距 */
function DropMarker() {
  return <div className={s.dropMarker} />;
}

/** 拖拽时光标旁的浮动按钮预览 */
function DragPreview({ btnId, x, y }: { btnId: string; x: number; y: number }) {
  const def = PANEL_DEFS[btnId];
  if (!def) return null;
  const Icon = def.icon;

  return (
    <div className={s.dragPreview} style={{ left: x, top: y }}>
      <Icon size={14} />
    </div>
  );
}
