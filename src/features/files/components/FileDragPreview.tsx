import { createPortal } from 'react-dom';
import { iconSizes, Folder } from '@ui/icons';
import { fileIcon } from '@features/files/utils/fileIcon';
import { useFileDragStore } from '@features/files';

/** Drag preview: shows the icon of the dragged file/folder (with a count badge for multi-selection); excluded from hit testing. */
export default function FileDragPreview() {
  const items = useFileDragStore((state) => state.items);
  const pointer = useFileDragStore((state) => state.pointer);
  if (items.length === 0 || !pointer) return null;
  const first = items[0]!;
  const Icon = first.is_dir ? Folder : fileIcon(first.name);
  return createPortal(
    <div
      aria-hidden="true"
      data-testid="file-drag-preview"
      style={{
        position: 'fixed',
        left: pointer.x + 12,
        top: pointer.y + 12,
        zIndex: 90,
        pointerEvents: 'none',
        width: 30,
        height: 30,
        borderRadius: 7,
        background: 'var(--elevated)',
        border: '1px solid var(--border)',
        boxShadow: '0 6px 18px rgba(0, 0, 0, 0.28)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: first.is_dir ? 'var(--text-primary)' : 'var(--text-secondary)',
      }}
    >
      <Icon size={iconSizes.row} />
      {items.length > 1 && (
        <span style={{
          position: 'absolute', right: -6, bottom: -6, minWidth: 15, height: 15, padding: '0 3px',
          borderRadius: 8, background: 'var(--accent)', color: 'var(--accent-contrast, #fff)',
          fontSize: 'calc(10px * var(--ui-font-scale))', lineHeight: '15px', textAlign: 'center',
        }}>
          {items.length}
        </span>
      )}
    </div>,
    document.body,
  );
}
