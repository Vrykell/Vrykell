import { createPortal } from 'react-dom';
import { useFileDragStore } from '@features/files';

/** 拖拽预览：跟随指针显示移动/复制的条目数与目标文件夹，不参与命中测试。 */
export default function FileDragPreview() {
  const paths = useFileDragStore((state) => state.paths);
  const pointer = useFileDragStore((state) => state.pointer);
  const overPath = useFileDragStore((state) => state.overPath);
  const copy = useFileDragStore((state) => state.copy);
  if (paths.length === 0 || !pointer) return null;
  const target = overPath ? overPath.split('/').pop() : null;
  return createPortal(
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        left: pointer.x + 14,
        top: pointer.y + 14,
        zIndex: 90,
        pointerEvents: 'none',
        padding: '3px 8px',
        borderRadius: 6,
        background: 'var(--elevated)',
        border: '1px solid var(--border)',
        boxShadow: '0 6px 18px rgba(0, 0, 0, 0.28)',
        color: 'var(--text-secondary)',
        fontSize: 'calc(11px * var(--ui-font-scale))',
        whiteSpace: 'nowrap',
      }}
    >
      {copy ? '复制' : '移动'} {paths.length} 项{target ? ` → ${target}` : ''}
    </div>,
    document.body,
  );
}
