import { useEffect, useRef } from 'react';

interface ResizeHandleProps {
  axis: 'x' | 'y';
  /** 仅 axis='x' 时有效：手柄在元素的哪一侧。'right'=左侧面板用（手柄在右边缘），'left'=右侧面板用（手柄在左边缘） */
  edge?: 'left' | 'right';
  onDelta: (d: number) => void;
}

/**
 * ResizeHandle — 通用拖拽调整大小手柄。
 *
 * 绝对定位叠放在目标面板的内边缘，不占 flex 空间 → 无可见缝隙。
 * axis='x': 水平拖动（cursor=col-resize），axis='y': 垂直拖动（cursor=row-resize）。
 */
export default function ResizeHandle({ axis, edge = 'right', onDelta }: ResizeHandleProps) {
  const startRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const onDeltaRef = useRef(onDelta);
  onDeltaRef.current = onDelta;

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const s = startRef.current;
      if (!s) return;
      const d = axis === 'x' ? e.clientX - s.clientX : e.clientY - s.clientY;
      s.clientX = e.clientX;
      s.clientY = e.clientY;
      if (d !== 0) onDeltaRef.current(d);
    };
    const onUp = () => {
      startRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [axis]);

  const isX = axis === 'x';
  const cursor = isX ? 'col-resize' : 'row-resize';

  return (
    <div
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        startRef.current = { clientX: e.clientX, clientY: e.clientY };
        document.body.style.cursor = cursor;
        document.body.style.userSelect = 'none';
      }}
      style={{
        position: 'absolute',
        background: 'transparent',
        cursor,
        zIndex: 2,
        // 2px 透明线 → hover/拖拽时蓝色全高线
        ...(isX
          ? {
              [edge === 'right' ? 'right' : 'left']: 0,
              top: 0, bottom: 0, width: 8,
              [`border${edge === 'right' ? 'Left' : 'Right'}`]: '2px solid transparent',
              transition: 'border-color 0.15s ease',
            }
          : {
              left: 0, right: 0, top: -2, height: 8,
              borderTop: '2px solid transparent',
              transition: 'border-color 0.15s ease',
            }),
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLElement;
        const prop = isX
          ? (edge === 'right' ? 'borderLeftColor' : 'borderRightColor')
          : 'borderTopColor';
        el.style.setProperty(prop, 'var(--accent)');
      }}
      onMouseLeave={(e) => {
        if (!startRef.current) {
          const el = e.currentTarget as HTMLElement;
          const prop = isX
            ? (edge === 'right' ? 'borderLeftColor' : 'borderRightColor')
            : 'borderTopColor';
          el.style.setProperty(prop, 'transparent');
        }
      }}
    />
  );
}
