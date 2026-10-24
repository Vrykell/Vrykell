import { forwardRef, useRef, type ComponentPropsWithoutRef } from 'react';
import { beginLayoutResizeDrag, endLayoutResizeDrag } from '@ui/layout/layoutResizeDrag';
import { t } from '@i18n';

import type { PaneRect, PaneEdges } from '@core/paneLayout';
export type { PaneRect, PaneEdges } from '@core/paneLayout';

export const SplitPaneSurface = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<'div'> & { inner: PaneEdges }>(function SplitPaneSurface({ inner, style, ...props }, ref) {
  return <div {...props} ref={ref} data-split-surface style={{
    flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative', background: 'var(--xterm-bg)',
    borderTop: inner.top ? '1px solid var(--border)' : 'none', borderBottom: inner.bottom ? '1px solid var(--border)' : 'none',
    borderLeft: inner.left ? '1px solid var(--border)' : 'none', borderRight: inner.right ? '1px solid var(--border)' : 'none', overflow: 'hidden', ...style,
  }} />;
});

export function SplitDivider({ dir, rect, region, ratio, onRatio, minWidth = 360, minHeight = 135, thickness = 6, testId }: {
  dir: 'row' | 'col'; rect: PaneRect; region: PaneRect; ratio: number; onRatio: (ratio: number) => void;
  minWidth?: number; minHeight?: number; thickness?: number; testId?: string;
}) {
  const ref = useRef<HTMLDivElement>(null); const row = dir === 'row';
  const clamp = (value: number, size: number) => {
    const minimum = (row ? minWidth : minHeight) + thickness / 2;
    return Math.max(Math.min(0.5, minimum / size), Math.min(Math.max(0.5, 1 - minimum / size), value));
  };
  return <div ref={ref} data-testid={testId} data-split-divider role="separator" aria-label={t('Resize workspace panes')}
    aria-orientation={row ? 'vertical' : 'horizontal'} aria-valuenow={Math.round(ratio * 100)} aria-valuemin={10} aria-valuemax={90} tabIndex={0}
    onDoubleClick={() => onRatio(0.5)} onKeyDown={event => {
      if (event.key === 'Home') { event.preventDefault(); onRatio(0.5); return; }
      const delta = event.key === (row ? 'ArrowLeft' : 'ArrowUp') ? -16 : event.key === (row ? 'ArrowRight' : 'ArrowDown') ? 16 : 0;
      const bounds = ref.current?.parentElement?.getBoundingClientRect(); if (!delta || !bounds) return;
      event.preventDefault(); const size = row ? bounds.width * region.w : bounds.height * region.h;
      if (size > 0) onRatio(clamp(ratio + delta / size, size));
    }} onMouseDown={event => {
      event.preventDefault(); event.stopPropagation();
      const bounds = ref.current?.parentElement?.getBoundingClientRect(); if (!bounds) return;
      const size = row ? bounds.width * region.w : bounds.height * region.h; if (size <= 0) return;
      const origin = row ? bounds.left + region.x * bounds.width : bounds.top + region.y * bounds.height;
      beginLayoutResizeDrag();
      const move = (next: MouseEvent) => onRatio(clamp(((row ? next.clientX : next.clientY) - origin) / size, size));
      const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); endLayoutResizeDrag(); };
      document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
    }} onMouseEnter={event => { event.currentTarget.style.background = 'var(--accent-bg)'; }} onMouseLeave={event => { event.currentTarget.style.background = 'transparent'; }}
    style={{ position: 'absolute', zIndex: 5, cursor: row ? 'col-resize' : 'row-resize', transition: 'background 0.12s ease',
      left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: row ? thickness : `${rect.w * 100}%`, height: row ? `${rect.h * 100}%` : thickness,
      transform: row ? 'translateX(-50%)' : 'translateY(-50%)' }} />;
}
