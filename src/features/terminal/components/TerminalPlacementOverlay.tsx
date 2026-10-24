import { useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { PlacementOverlay as SharedPlacementOverlay, pickDropZone, ZonePreview } from '@ui/layout/PanePlacement';
import { useDockDragStore } from '@features/workspace';
import { moveTargets, type DropTarget, type WindowLayout } from '@features/workspace/model/windowLayout';
import { t } from '@i18n';

export function PlacementOverlay(props: ComponentProps<typeof SharedPlacementOverlay>) {
  return <SharedPlacementOverlay {...props} emptyMessage={props.emptyMessage ?? t('At most 4 terminals')} />;
}

export function MoveDragLayer({ layout, draggingId, onCommit }: { layout: WindowLayout; draggingId: string; onCommit: (dragId: string, zone: DropTarget) => void }) {
  const targets = useMemo(() => moveTargets(layout, draggingId), [layout, draggingId]);
  const [hovered, setHovered] = useState<number | null>(null);
  const hoveredRef = useRef<number | null>(null); const overlayRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const move = (event: MouseEvent) => {
      const bounds = overlayRef.current?.getBoundingClientRect();
      const index = bounds?.width && bounds.height ? pickDropZone(targets, (event.clientX - bounds.left) / bounds.width, (event.clientY - bounds.top) / bounds.height) : null;
      hoveredRef.current = index; setHovered(index);
    };
    const up = () => { const index = hoveredRef.current; if (index !== null && targets[index]) onCommit(draggingId, targets[index]!); useDockDragStore.getState().end(); };
    const cancel = () => useDockDragStore.getState().end();
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); } };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up); window.addEventListener('keydown', key, true); window.addEventListener('blur', cancel);
    return () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); window.removeEventListener('keydown', key, true); window.removeEventListener('blur', cancel); };
  }, [targets, draggingId, onCommit]);
  return targets.length ? <div ref={overlayRef} style={{ position: 'absolute', inset: 0, zIndex: 79, cursor: 'grabbing' }}>
    {hovered !== null && targets[hovered] && <ZonePreview testId={`move-placement-zone-${hovered}`} target={targets[hovered]!} />}
  </div> : null;
}
