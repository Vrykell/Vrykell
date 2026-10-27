import { useEffect, useRef } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { FileDropTarget } from '@features/files/stores/fileDrag';

interface UseExternalFileDropOptions {
  /** Pointer position (CSS pixels) → drop target; null means the location does not accept drops */
  resolveTarget: (x: number, y: number) => FileDropTarget | null;
  onHover: (target: FileDropTarget | null) => void;
  onDrop: (paths: string[], target: FileDropTarget) => void;
}

/**
 * Native file drop into the panel: handled through the host's native drag-drop events.
 * Native file drops (with real paths) and HTML5 drag-and-drop are mutually exclusive on some
 * platforms, so external drops all go through this channel while in-app drags
 * use pointer events; both share the data-drop-dir hit testing.
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
