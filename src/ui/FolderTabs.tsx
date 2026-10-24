import { Fragment, useId, useRef, useState, type ReactNode } from 'react';
import { IconButton } from './IconButton';
import EditorActions from './EditorActions';
import type { ContextMenuItem } from './ContextMenu';
import { X } from './icons';
import { t } from '@i18n';
import { ListReorderPlaceholder, ListReorderPreview, useListReorder, useListReorderDrag } from './listReorder';
import { useHorizontalWheel } from './hooks/useHorizontalWheel';
import { useActiveTabVisibility } from './hooks/useActiveTabVisibility';
import './FolderTabs.css';
import { TextInput } from './TextInput';

export interface FolderTab { id: string; label: string; icon: ReactNode; tip: string; closeLabel: string; closeTestId?: string; dataAttributes?: Record<string, string>; surface?: 'canvas'; renameable?: boolean }

/** Connected document tabs share dragging, wheel navigation and reserved toolbar space. */
export default function FolderTabs({ items, selected, label, listId, className = '', headerClassName = '', toolbar, menuItems, onSelect, onClose, onMove, onRename }: {
  items: FolderTab[]; selected: string; label: string; className?: string; headerClassName?: string; toolbar: ReactNode;
  listId?: string;
  menuItems?: ContextMenuItem[];
  onSelect: (id: string) => void; onClose: (id: string) => void; onMove: (id: string, over: string, after: boolean) => void;
  onRename?: (id: string, title: string) => void;
}) {
  const instanceId = useId(); const id = listId ?? instanceId; const strip = useRef<HTMLDivElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const renameFinished = useRef(false);
  const dragId = useListReorder(state => state.drag?.listId === id ? state.drag.id : null);
  const start = useListReorderDrag({ listId: id, axis: 'horizontal', onDrop: (drag, target) => { if (target?.itemId) onMove(drag.id, target.itemId, !!target.after); } });
  useHorizontalWheel(strip, items.length > 0);
  useActiveTabVisibility(strip, '.folder-tab[data-active="true"]', `${selected}:${items.length}`);
  const remaining = items.filter(item => item.id !== dragId); const last = remaining[remaining.length - 1]?.id;
  const beginRename = (item: FolderTab) => {
    if (!onRename || item.renameable === false) return;
    renameFinished.current = false;
    setEditingId(item.id);
    setEditTitle(item.label);
  };
  const commitRename = () => {
    if (renameFinished.current) return;
    renameFinished.current = true;
    if (editingId && editTitle.trim()) onRename?.(editingId, editTitle.trim());
    setEditingId(null);
  };
  const cancelRename = () => {
    renameFinished.current = true;
    setEditingId(null);
  };
  return <header className={`folder-header ${headerClassName}`}>
    {menuItems && <div className="folder-more"><EditorActions items={menuItems} /></div>}
    {items.length > 0 ? <div ref={strip} className={`folder-tab-list ${className}`} role="tablist" aria-label={label} data-reorder-list={id}>
      {items.map(item => <Fragment key={item.id}>
        <ListReorderPlaceholder listId={id} itemId={item.id} />
        <div {...item.dataAttributes} className="folder-tab" data-active={selected === item.id} data-reorder-item={item.id} data-reorder-kind="document" data-reorder-dragging={dragId === item.id ? 'true' : undefined} data-tab-surface={item.surface} onPointerDown={event => {
          if (event.button !== 0 || event.isPrimary === false || (event.target as Element).closest('input, [data-no-drag]')) return;
          start(event, { id: item.id, kind: 'document' });
          if (selected !== item.id) onSelect(item.id);
        }}>
          <FolderTabContent item={item} selected={selected === item.id} onSelect={onSelect} onClose={onClose}
            editing={editingId === item.id} editTitle={editTitle} setEditTitle={setEditTitle}
            onStartRename={() => beginRename(item)} onCommitRename={commitRename} onCancelRename={cancelRename} />
        </div>
        {last === item.id && <ListReorderPlaceholder listId={id} itemId={item.id} after />}
      </Fragment>)}
    </div> : <div className="folder-tab-spacer" />}
    <div className="folder-actions">{toolbar}</div>
    {items.length > 0 && <ListReorderPreview listId={id} variant="item">{drag => {
      const item = items.find(item => item.id === drag.id);
      return item && <div className="folder-tab folder-tab-preview" data-active={selected === item.id} data-tab-surface={item.surface}>
        <FolderTabContent item={item} selected={selected === item.id} />
      </div>;
    }}</ListReorderPreview>}
  </header>;
}

export function FolderTabContent({ item, selected, onSelect, onClose, editing = false, editTitle = '', setEditTitle,
  onStartRename, onCommitRename, onCancelRename,
}: {
  item: FolderTab; selected: boolean; onSelect?: (id: string) => void; onClose?: (id: string) => void;
  editing?: boolean; editTitle?: string; setEditTitle?: (title: string) => void;
  onStartRename?: () => void; onCommitRename?: () => void; onCancelRename?: () => void;
}) {
  return <div className="folder-tab-content">
    {editing ? <TextInput variant="field" data-no-drag autoFocus aria-label={t('Tab title')} className="inline-rename-input" value={editTitle}
      onChange={event => setEditTitle?.(event.target.value)} onFocus={event => event.currentTarget.select()}
      onClick={event => event.stopPropagation()} onBlur={onCommitRename} onKeyDown={event => {
        event.stopPropagation();
        if (event.key === 'Enter') onCommitRename?.();
        if (event.key === 'Escape') onCancelRename?.();
      }} /> : <>
      <button role="tab" data-reorder-handle aria-selected={selected} data-tip={item.tip}
        onDoubleClick={event => { if (!onStartRename) return; event.stopPropagation(); onStartRename(); }}
        onClick={() => { if (!selected) onSelect?.(item.id); }}>{item.icon}<span>{item.label}</span></button>
      <IconButton compact data-no-drag data-testid={item.closeTestId} aria-label={item.closeLabel} onClick={() => onClose?.(item.id)}><X size={14} /></IconButton>
    </>}
  </div>;
}
