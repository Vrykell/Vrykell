import { useEffect, useRef } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { FileDropTarget } from '@features/files/stores/fileDrag';

interface UseExternalFileDropOptions {
  /** 指针位置（CSS 像素）→ 放置目标；返回 null 表示该处不接受放置 */
  resolveTarget: (x: number, y: number) => FileDropTarget | null;
  onHover: (target: FileDropTarget | null) => void;
  onDrop: (paths: string[], target: FileDropTarget) => void;
}

/**
 * 系统文件拖入面板：走 Tauri 的原生拖放事件。
 * Windows 上「原生文件拖入（带真实路径）」与 HTML5 拖放互斥（tauri dragDropEnabled），
 * 因此拖入统一走这条通道，应用内拖拽用指针事件，两者共用 data-drop-dir 命中测试。
 */
export function useExternalFileDrop({ resolveTarget, onHover, onDrop }: UseExternalFileDropOptions) {
  const latest = useRef({ resolveTarget, onHover, onDrop });
  useEffect(() => {
    latest.current = { resolveTarget, onHover, onDrop };
  }, [resolveTarget, onHover, onDrop]);

  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const scale = () => window.devicePixelRatio || 1;

    getCurrentWindow().onDragDropEvent((event) => {
      if (disposed) return;
      const payload = event.payload as {
        type: string;
        position?: { x: number; y: number };
        paths?: string[];
      };
      if (payload.type === 'leave') {
        latest.current.onHover(null);
        return;
      }
      if (!payload.position) return;
      const x = payload.position.x / scale();
      const y = payload.position.y / scale();
      const target = latest.current.resolveTarget(x, y);
      if (payload.type === 'drop') {
        latest.current.onHover(null);
        if (target && payload.paths && payload.paths.length > 0) latest.current.onDrop(payload.paths, target);
        return;
      }
      latest.current.onHover(target);
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    }).catch(() => {});

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
}
