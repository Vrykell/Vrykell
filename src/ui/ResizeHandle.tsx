import { useRef } from 'react';
import { beginLayoutResizeDrag, endLayoutResizeDrag } from './layoutResizeDrag';

interface ResizeHandleProps {
  axis: 'x' | 'y';
  /** Only for axis='x': which side of the element the handle sits on.
   *  'right' = left sidebar (handle on its right edge), 'left' = right sidebar (handle on its left edge). */
  edge?: 'left' | 'right';
  onDelta: (d: number) => void;
  /** Release callback, e.g. to commit a collapsed width. */
  onUp?: () => void;
  testId?: string;
  label?: string;
  valueNow?: number;
  valueMin?: number;
  valueMax?: number;
  onReset?: () => void;
  lineThickness?: number;
  /** Paint the resting divider; hover and drag feedback remain available. */
  showRestingLine?: boolean;
}

/** Grab strip thickness (px). The strip stays transparent; only its hairline is painted. */
const HANDLE_THICKNESS = 8;
/** Divider thickness (px), drawn on the element edge the strip is anchored to. */
const LINE_THICKNESS = 1;

/**
 * ResizeHandle — generic drag-to-resize handle.
 *
 * Absolutely positioned across the edge of its target and out of flex flow, so it
 * costs no visible gap: a 1px hairline marks the boundary between the panel and the
 * neighbouring surface (--resize-divider at rest, --border-strong while hovered or dragged), and the
 * 8px strip around it is the transparent grab area.
 * axis='x': horizontal drag (cursor=col-resize), axis='y': vertical drag (cursor=row-resize).
 *
 * Drag listeners bind on mousedown and unbind on mouseup, deliberately **not** tied to
 * component lifetime: a panel can collapse mid-drag (unmounting this handle), and the
 * document-level listeners must keep working until the button is released so the user
 * can drag back out of the collapse.
 */
export default function ResizeHandle({ axis, edge = 'right', onDelta, onUp, testId, label, valueNow, valueMin, valueMax, onReset, lineThickness = LINE_THICKNESS, showRestingLine = true }: ResizeHandleProps) {
  const startRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const cleanupRef = useRef<() => void>(() => {});
  const lineRef = useRef<HTMLDivElement>(null);
  const onDeltaRef = useRef(onDelta);
  onDeltaRef.current = onDelta;
  const onUpRef = useRef(onUp);
  onUpRef.current = onUp;

  const isX = axis === 'x';
  const cursor = isX ? 'col-resize' : 'row-resize';

  const paintLine = (color: string) => {
    const line = lineRef.current;
    if (line) line.style.backgroundColor = color;
  };

  return (
    <div
      data-testid={testId}
      role={label ? 'separator' : undefined}
      aria-label={label}
      aria-valuenow={valueNow}
      aria-valuemin={valueMin}
      aria-valuemax={valueMax}
      aria-orientation={label ? isX ? 'vertical' : 'horizontal' : undefined}
      tabIndex={label ? 0 : undefined}
      data-tip={label}
      onDoubleClick={onReset}
      onKeyDown={event => {
        if (!label) return;
        if (event.key === 'Home' && onReset) { event.preventDefault(); onReset(); return; }
        const negative = isX ? 'ArrowLeft' : 'ArrowUp';
        const positive = isX ? 'ArrowRight' : 'ArrowDown';
        if (event.key === negative || event.key === positive) { event.preventDefault(); onDelta(event.key === negative ? -16 : 16); onUp?.(); }
      }}
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        cleanupRef.current(); // Defensive: a repeated mousedown must release the previous listeners first.
        beginLayoutResizeDrag();
        startRef.current = { clientX: e.clientX, clientY: e.clientY };
        paintLine('var(--border-strong)');
        document.body.style.cursor = cursor;
        document.body.style.userSelect = 'none';

        const onMove = (ev: MouseEvent) => {
          const s = startRef.current;
          if (!s) return;
          const d = isX ? ev.clientX - s.clientX : ev.clientY - s.clientY;
          s.clientX = ev.clientX;
          s.clientY = ev.clientY;
          if (d !== 0) onDeltaRef.current(d);
        };
        const onUp = () => {
          cleanupRef.current();
          onUpRef.current?.();
        };
        cleanupRef.current = () => {
          startRef.current = null;
          document.body.style.cursor = '';
          document.body.style.userSelect = '';
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          paintLine(showRestingLine ? 'var(--resize-divider)' : 'transparent');
          endLayoutResizeDrag();
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      }}
      onMouseEnter={() => paintLine('var(--border-strong)')}
      onMouseLeave={() => {
        // Keep the highlight while dragging, even when the pointer leaves the strip.
        if (!startRef.current) paintLine(showRestingLine ? 'var(--resize-divider)' : 'transparent');
      }}
      style={{
        position: 'absolute',
        background: 'transparent',
        cursor,
        zIndex: 2,
        ...(isX
          ? { [edge === 'right' ? 'right' : 'left']: -HANDLE_THICKNESS / 2, top: 0, bottom: 0, width: HANDLE_THICKNESS }
          : { left: 0, right: 0, top: -HANDLE_THICKNESS / 2, height: HANDLE_THICKNESS }),
      }}
    >
      <div
        data-resize-line
        ref={lineRef}
        aria-hidden
        style={{
          position: 'absolute',
          backgroundColor: showRestingLine ? 'var(--resize-divider)' : 'transparent',
          transition: 'background-color var(--dur) var(--ease)',
          ...(isX
            ? { left: `calc(50% - ${lineThickness / 2}px)`, top: 0, bottom: 0, width: lineThickness }
            : { top: `calc(50% - ${lineThickness / 2}px)`, left: 0, right: 0, height: lineThickness }),
        }}
      />
    </div>
  );
}
