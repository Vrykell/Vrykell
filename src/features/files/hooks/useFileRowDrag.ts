import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { startDrag } from '@crabnebula/tauri-plugin-drag';
import { useFileDragStore, type FileDragItem, type FileDropTarget } from '@features/files/stores/fileDrag';

/** 拖动阈值（与导航拖拽一致）：超过才视为拖拽，避免误触。 */
const DRAG_THRESHOLD_PX = 6;

/** 指针离开窗口多远后交给系统原生拖拽。 */
const NATIVE_DRAG_MARGIN_PX = 8;

/** 指针下方的放置目标：带 data-drop-dir 的文件夹行 / 文件行（其同级目录）或面包屑。 */
function locateDropTarget(x: number, y: number): FileDropTarget | null {
  const hit = document.elementFromPoint(x, y);
  const zone = hit?.closest<HTMLElement>('[data-drop-dir]');
  const dir = zone?.dataset.dropDir;
  if (!zone || !dir) return null;
  return { rowPath: zone.dataset.path ?? null, dir };
}

function isOutsideWindow(x: number, y: number): boolean {
  return x <= -NATIVE_DRAG_MARGIN_PX || y <= -NATIVE_DRAG_MARGIN_PX
    || x >= window.innerWidth + NATIVE_DRAG_MARGIN_PX
    || y >= window.innerHeight + NATIVE_DRAG_MARGIN_PX;
}

/** 交给系统原生拖拽的载荷：本地路径 + 拖拽效果（本地移动；远程先下载再按复制拖出）。 */
export interface NativeDragPayload {
  paths: string[];
  mode: 'copy' | 'move';
}

export interface FileRowDragOptions {
  onDrop: (items: FileDragItem[], target: FileDropTarget) => void;
  /** 拖出窗口前准备本地路径（远程条目先下载）；返回 null 表示取消本次拖出。 */
  prepareNativeDrag?: (items: FileDragItem[]) => Promise<NativeDragPayload | null> | NativeDragPayload | null;
  /** 系统拖拽结束后的回调（刷新面板）。 */
  onNativeDragEnd?: () => void;
}

/** 拖出窗口：交给系统原生拖拽（拖到桌面/资源管理器），结束后刷新面板以反映系统侧改动。 */
function beginNativeDrag(payload: NativeDragPayload, onEnd?: () => void) {
  if (!('__TAURI_INTERNALS__' in window)) return;
  // 预览图留空：读取失败时按“无自定义拖动图”处理（Windows 回退系统默认拖动图）
  void startDrag({ item: payload.paths, icon: '', mode: payload.mode })
    .catch(() => {})
    .finally(() => onEnd?.());
}

/**
 * 行拖拽：按住行拖到文件夹/文件（同级目录）/面包屑即可移动（拖拽只做移动，不复制）；
 * 拖出窗口则转为系统原生拖拽，可直接放到桌面 / 资源管理器。
 * 面板内用指针事件而不是 HTML5 拖放，避免与桌面窗口的原生文件拖入冲突。
 */
export function useFileRowDrag({ onDrop, prepareNativeDrag, onNativeDragEnd }: FileRowDragOptions) {
  const cleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanupRef.current?.(), []);

  return (event: ReactPointerEvent<HTMLElement>, items: FileDragItem[]) => {
    if (event.button !== 0 || event.isPrimary === false || items.length === 0) return;
    // 展开箭头与重命名输入框不参与拖拽
    if ((event.target as HTMLElement).closest('input, [data-testid="file-row-expander"]')) return;

    cleanupRef.current?.();
    const source = event.currentTarget;
    const { pointerId, clientX, clientY } = event;
    let started = false;
    let canceled = false;
    let clickTimer: ReturnType<typeof setTimeout> | undefined;
    source.setPointerCapture?.(pointerId);

    const move = (next: PointerEvent) => {
      if (next.pointerId !== pointerId || canceled) return;
      if (!started && Math.hypot(next.clientX - clientX, next.clientY - clientY) < DRAG_THRESHOLD_PX) return;
      if (!started) {
        started = true;
        useFileDragStore.getState().start(items, { x: next.clientX, y: next.clientY });
      }
      next.preventDefault();
      // 拖出窗口：转成系统原生拖拽（可以放到桌面 / 资源管理器）
      if (isOutsideWindow(next.clientX, next.clientY)) {
        canceled = true;
        useFileDragStore.getState().end();
        clean();
        void (async () => {
          const payload = prepareNativeDrag
            ? await prepareNativeDrag(items)
            : { paths: items.map((item) => item.path), mode: 'move' as const };
          if (payload) beginNativeDrag(payload, onNativeDragEnd);
        })();
        return;
      }
      const store = useFileDragStore.getState();
      store.movePointer({ x: next.clientX, y: next.clientY });
      store.hover(locateDropTarget(next.clientX, next.clientY));
    };
    const suppressClick = (next: MouseEvent) => {
      if (started) { next.preventDefault(); next.stopImmediatePropagation(); }
    };
    const removeClick = () => window.removeEventListener('click', suppressClick, true);

    const clean = () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', cancel, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', cancel);
      if (source.hasPointerCapture?.(pointerId)) source.releasePointerCapture(pointerId);
      if (started) useFileDragStore.getState().end();
      // pointerup 之后浏览器还会派发 click：延迟一拍再解除抑制，避免拖完误选中
      clickTimer = setTimeout(removeClick, 0);
      cleanupRef.current = () => { clearTimeout(clickTimer); removeClick(); };
    };

    const up = (next: PointerEvent) => {
      if (next.pointerId !== pointerId) return;
      if (started && !canceled) {
        const target = locateDropTarget(next.clientX, next.clientY);
        if (target) onDrop(items, target);
      }
      clean();
    };

    const cancel = () => {
      canceled = true;
      if (started) useFileDragStore.getState().end();
      clean();
    };

    const key = (next: KeyboardEvent) => {
      if (next.key !== 'Escape') return;
      next.preventDefault();
      next.stopImmediatePropagation();
      cancel();
    };

    window.addEventListener('pointermove', move, { capture: true, passive: false });
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', cancel, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('blur', cancel);
    window.addEventListener('click', suppressClick, true);
    cleanupRef.current = () => { clean(); clearTimeout(clickTimer); removeClick(); };
  };
}
