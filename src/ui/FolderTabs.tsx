import { Fragment, useEffect, useId, useRef, type ReactNode } from 'react';
import { IconButton } from './IconButton';
import { X } from './icons';
import { ListReorderPlaceholder, ListReorderPreview, useListReorder, useListReorderDrag } from './listReorder';
import { useHorizontalWheel } from './hooks/useHorizontalWheel';
import './FolderTabs.css';

export interface FolderTab { id: string; label: string; icon: ReactNode; tip: string; closeLabel: string }

/** Connected document tabs share dragging, wheel navigation and reserved toolbar space. */
export default function FolderTabs({ items, selected, label, className = '', headerClassName = '', toolbar, onSelect, onClose, onMove }: {
  items: FolderTab[]; selected: string; label: string; className?: string; headerClassName?: string; toolbar: ReactNode;
  onSelect: (id: string) => void; onClose: (id: string) => void; onMove: (id: string, over: string, after: boolean) => void;
}) {
  const id = useId(); const strip = useRef<HTMLDivElement>(null);
  const dragId = useListReorder(state => state.drag?.listId === id ? state.drag.id : null);
  const start = useListReorderDrag({ listId: id, axis: 'horizontal', onDrop: (drag, target) => { if (target?.itemId) onMove(drag.id, target.itemId, !!target.after); } });
  useHorizontalWheel(strip, items.length > 0);
  useEffect(() => { strip.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); }, [selected]);
  const remaining = items.filter(item => item.id !== dragId); const last = remaining[remaining.length - 1]?.id;
  return <header className={`folder-header ${headerClassName}`}>
    {items.length > 0 ? <div ref={strip} className={`folder-tab-list ${className}`} role="tablist" aria-label={label} data-reorder-list={id}>
      {items.map(item => <Fragment key={item.id}>
        <ListReorderPlaceholder listId={id} itemId={item.id} />
        <div className="folder-tab" data-active={selected === item.id} data-reorder-item={item.id} data-reorder-kind="document" data-reorder-dragging={dragId === item.id ? 'true' : undefined} onPointerDown={event => start(event, { id: item.id, kind: 'document' })}>
          <button role="tab" data-reorder-handle aria-selected={selected === item.id} data-tip={item.tip} onClick={() => onSelect(item.id)}>{item.icon}<span>{item.label}</span></button>
          <IconButton compact data-no-drag aria-label={item.closeLabel} onClick={() => onClose(item.id)}><X size={14} /></IconButton>
        </div>
        {last === item.id && <ListReorderPlaceholder listId={id} itemId={item.id} after />}
      </Fragment>)}
    </div> : <div className="folder-tab-spacer" />}
    <div className="folder-actions">{toolbar}</div>
    <ListReorderPreview listId={id}>{drag => items.find(item => item.id === drag.id)?.icon}</ListReorderPreview>
  </header>;
}
