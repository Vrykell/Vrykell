import { useRef } from 'react';
import { cx } from '@/styles/cx';
import s from './ResizeHandle.module.css';

interface ResizeHandleProps {
  axis: 'x' | 'y';
  /** 仅 axis='x' 时有效：手柄在元素的哪一侧。'right'=左侧面板用（手柄在右边缘），'left'=右侧面板用（手柄在左边缘） */
  edge?: 'left' | 'right';
  onDelta: (d: number) => void;
  onUp?: () => void;
  testId?: string;
}

/**
 * ResizeHandle — 通用拖拽调整大小手柄。
 *
 * 绝对定位叠放在目标面板的内边缘，不占 flex 空间 → 无可见缝隙。
 * 拖动监听随 mousedown 绑定、mouseup 解除，**不随组件卸载清理**：
 * 拖拽过程中面板可能被折叠（组件卸载），只要鼠标未松开，document 级监听继续工作。
 */
export default function ResizeHandle({
  axis,
  edge = 'right',
  onDelta,
  onUp,
  testId,
}: ResizeHandleProps) {
  const startRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const cleanupRef = useRef<() => void>(() => {});
  const onDeltaRef = useRef(onDelta);
  onDeltaRef.current = onDelta;
  const onUpRef = useRef(onUp);
  onUpRef.current = onUp;

  const isX = axis === 'x';
  const cursor = isX ? 'col-resize' : 'row-resize';

  return (
    <div
      data-testid={testId}
      className={cx(
        s.handle,
        isX ? (edge === 'left' ? `${s.handleX} ${s.handleXLeft}` : s.handleX) : s.handleY,
      )}
      style={{ cursor }}
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        cleanupRef.current();
        startRef.current = { clientX: e.clientX, clientY: e.clientY };
        document.body.style.cursor = cursor;
        document.body.style.userSelect = 'none';

        const onMove = (ev: MouseEvent) => {
          const st = startRef.current;
          if (!st) return;
          const d = isX ? ev.clientX - st.clientX : ev.clientY - st.clientY;
          st.clientX = ev.clientX;
          st.clientY = ev.clientY;
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
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      }}
    />
  );
}
