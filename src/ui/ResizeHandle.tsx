import { useRef } from 'react';

interface ResizeHandleProps {
  axis: 'x' | 'y';
  /** 仅 axis='x' 时有效：手柄在元素的哪一侧。'right'=左侧面板用（手柄在右边缘），'left'=右侧面板用（手柄在左边缘） */
  edge?: 'left' | 'right';
  onDelta: (d: number) => void;
  /** 松手回调（拖动结束提交用：如面板宽度 commit 折叠判定） */
  onUp?: () => void;
  testId?: string;
}

/**
 * ResizeHandle — 通用拖拽调整大小手柄。
 *
 * 绝对定位叠放在目标面板的内边缘，不占 flex 空间 → 无可见缝隙。
 * axis='x': 水平拖动（cursor=col-resize），axis='y': 垂直拖动（cursor=row-resize）。
 *
 * 拖动监听随 mousedown 绑定、mouseup 解除，**不随组件卸载清理**：
 * 拖拽过程中面板可能被折叠（组件卸载，如侧栏拖到最小宽度收起），
 * 只要鼠标未松开，document 级监听继续工作 —— 支持「折叠后反方向拖回」。
 */
export default function ResizeHandle({ axis, edge = 'right', onDelta, onUp, testId }: ResizeHandleProps) {
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
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        cleanupRef.current(); // 防御：重复 mousedown 先解绑旧的
        startRef.current = { clientX: e.clientX, clientY: e.clientY };
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
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
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
              top: 0, bottom: 0, width: 3,
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