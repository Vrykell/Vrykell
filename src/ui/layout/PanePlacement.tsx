import { useEffect, useRef, useState } from 'react';
import DropPlacementPreview from '@ui/layout/DropPlacementPreview';
import { Columns2, iconSizes } from '@ui/icons';
import type { PaneRect } from '@ui/layout/SplitPane';
import { useToastStore } from '@ui/feedback/Toast';

export interface PanePlacementTarget { leafId: string; dir: 'row' | 'col'; position: 'first' | 'second'; rect: PaneRect }

export function pickDropZone(targets: PanePlacementTarget[], nx: number, ny: number): number | null {
  let best: number | null = null; let bestScore = -Infinity;
  targets.forEach((target, index) => {
    const rect = target.rect;
    if (nx < rect.x - 1e-6 || nx > rect.x + rect.w + 1e-6 || ny < rect.y - 1e-6 || ny > rect.y + rect.h + 1e-6) return;
    const score = target.dir === 'row' ? target.position === 'first' ? rect.x + rect.w - nx : nx - rect.x : target.position === 'first' ? rect.y + rect.h - ny : ny - rect.y;
    if (score > bestScore) { bestScore = score; best = index; }
  });
  return best;
}

export function ZonePreview({ target, testId, hint }: { target: PanePlacementTarget; testId: string; hint?: string }) {
  return <DropPlacementPreview data-testid={testId} style={{ position: 'absolute', left: `${target.rect.x * 100}%`, top: `${target.rect.y * 100}%`, width: `${target.rect.w * 100}%`, height: `${target.rect.h * 100}%` }}>
    {hint && <><Columns2 size={iconSizes.navigation} /><span>{hint}</span></>}
  </DropPlacementPreview>;
}

export function PlacementOverlay({ targets, onPick, onCancel, hint, emptyMessage }: { targets: PanePlacementTarget[]; onPick: (target: PanePlacementTarget) => void; onCancel: () => void; hint?: string; emptyMessage?: string }) {
  const [hovered, setHovered] = useState<number | null>(null); const ref = useRef<HTMLDivElement>(null);
  const emptyReported = useRef(false);
  useEffect(() => {
    if (!targets.length) { if (emptyMessage && !emptyReported.current) { emptyReported.current = true; useToastStore.getState().addToast(emptyMessage, 'info'); } onCancel(); return; }
    ref.current?.focus();
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel(); } };
    const outside = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) onCancel(); };
    window.addEventListener('keydown', key, true); window.addEventListener('pointerdown', outside, true); window.addEventListener('blur', onCancel);
    return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('pointerdown', outside, true); window.removeEventListener('blur', onCancel); };
  }, [targets.length, onCancel, emptyMessage]);
  const locate = (x: number, y: number) => {
    const bounds = ref.current?.getBoundingClientRect();
    return bounds?.width && bounds.height ? pickDropZone(targets, (x - bounds.left) / bounds.width, (y - bounds.top) / bounds.height) : null;
  };
  return <div ref={ref} data-testid="placement-overlay" tabIndex={0} aria-label={hint} onClick={event => { const index = locate(event.clientX, event.clientY); if (index !== null) onPick(targets[index]!); else onCancel(); }}
    onMouseMove={event => setHovered(locate(event.clientX, event.clientY))} onMouseLeave={() => setHovered(null)}
    onKeyDown={event => {
      if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(event.key)) { event.preventDefault(); setHovered(index => ((index ?? -1) + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) + targets.length) % targets.length); }
      if ((event.key === 'Enter' || event.key === ' ') && hovered !== null) { event.preventDefault(); onPick(targets[hovered]!); }
    }} style={{ position: 'absolute', inset: 0, zIndex: 80, outline: 'none' }}>
    {hovered !== null && targets[hovered] && <ZonePreview testId={`placement-zone-${hovered}`} target={targets[hovered]!} hint={hint} />}
  </div>;
}
