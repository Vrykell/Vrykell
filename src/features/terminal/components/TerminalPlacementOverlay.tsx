/**
 * Placement overlays for terminal layouts.
 *
 * The picker (⌘D split or "replace position") commits on click; dragging a pane
 * commits on release. Both preview only the slot under the pointer — like the
 * sidebar's panel drop preview — as a plain gray surface without labels.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import DropPlacementPreview from '@ui/DropPlacementPreview';
import { useToastStore } from '@ui/Toast';
import { useDockDragStore } from '@features/workspace';
import {
  moveTargets,
  type DropTarget,
  type WindowLayout,
} from '@features/workspace/model/windowLayout';
import { t } from '@i18n';

/** Pick the slot containing the normalized pointer position (0..1); the deepest zone wins overlaps. */
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

/** The one preview the pointer currently expects, surfaced on the shared gray placement surface. */
function ZonePreview({ target, testId }: { target: DropTarget; testId: string }) {
  return (
    <DropPlacementPreview
      data-testid={testId}
      style={{
        position: 'absolute',
        left: `${target.rect.x * 100}%`,
        top: `${target.rect.y * 100}%`,
        width: `${target.rect.w * 100}%`,
        height: `${target.rect.h * 100}%`,
      }}
    />
  );
}

/** Click picker: hovering underlines the expected slot, clicking places the terminal there. */
export function PlacementOverlay({ targets, onPick, onCancel, emptyMessage }: {
  targets: DropTarget[];
  onPick: (target: DropTarget) => void;
  onCancel: () => void;
  emptyMessage?: string;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const emptyReported = useRef(false);

  useEffect(() => {
    if (targets.length === 0) {
      // StrictMode replays mount effects; report the full layout only once.
      if (!emptyReported.current) {
        emptyReported.current = true;
        useToastStore.getState().addToast(emptyMessage ?? t('At most 4 terminals'), 'info');
      }
      onCancel();
      return;
    }
    // Escape, a press outside the layout area or a window that loses focus ends the picker.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onCancel();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('blur', onCancel);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('blur', onCancel);
    };
  }, [targets.length, emptyMessage, onCancel]);

  const locate = (clientX: number, clientY: number): number | null => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    return pickDropZone(targets, (clientX - rect.left) / rect.width, (clientY - rect.top) / rect.height);
  };

  return (
    <div
      ref={ref}
      data-testid="placement-overlay"
      onClick={(e) => {
        const idx = locate(e.clientX, e.clientY);
        if (idx != null) onPick(targets[idx]!);
        else onCancel();
      }}
      onMouseMove={(e) => setHovered(locate(e.clientX, e.clientY))}
      onMouseLeave={() => setHovered(null)}
      style={{ position: 'absolute', inset: 0, zIndex: 80 }}
    >
      {hovered != null && targets[hovered] && (
        <ZonePreview testId={`placement-zone-${hovered}`} target={targets[hovered]!} />
      )}
    </div>
  );
}

/** Pane drag: the slot under the pointer previews where the pane lands once released. */
export function MoveDragLayer({ layout, draggingId, onCommit }: {
  layout: WindowLayout;
  draggingId: string;
  onCommit: (dragId: string, zone: DropTarget) => void;
}) {
  // Movable slots: every other terminal offers its top/bottom/left/right edges.
  const targets = useMemo(
    () => moveTargets(layout, draggingId),
    [layout, draggingId],
  );
  const [hovered, setHovered] = useState<number | null>(null);
  const hoveredRef = useRef<number | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      const rect = overlayRef.current?.getBoundingClientRect();
      let idx: number | null = null;
      if (rect && rect.width > 0 && rect.height > 0) {
        idx = pickDropZone(targets, (event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
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
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      useDockDragStore.getState().end();
    };
    // Losing the window ends the drag like it ends the navigation drag.
    const onBlur = () => useDockDragStore.getState().end();
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', onBlur);
    };
  }, [targets, draggingId, onCommit]);

  if (targets.length === 0) {
    // A single terminal has no movable slots; end immediately.
    return null;
  }

  return (
    <div ref={overlayRef} style={{ position: 'absolute', inset: 0, zIndex: 79, cursor: 'grabbing' }}>
      {hovered != null && targets[hovered] && (
        <ZonePreview testId={`move-placement-zone-${hovered}`} target={targets[hovered]!} />
      )}
    </div>
  );
}
