import { useId, useRef, useState, type ReactNode } from 'react';
import { IconButton } from '@ui/actions/IconButton';
import EditorActions from '@ui/menus/EditorActions';
import ContextMenu, { type ContextMenuItem, type MenuAnchor } from '@ui/menus/ContextMenu';
import { X } from '@ui/icons';
import { t } from '@i18n';
import '@ui/layout/FolderTabs.css';
import { TextInput } from '@ui/fields/TextInput';
import type { TabHandle } from './tabHandle';
import type { TabGroupController } from './tabGroups';
import GroupedTabList from './GroupedTabList';

/** All tab strips share grouping, menus, keyboard navigation and reserved toolbar space. */
export default function FolderTabs({ items, selected, label, listId, className = '', headerClassName = '', toolbar, leading, empty, menuItems, menuLabel, tabActions, onBlankContext, onSelect, onClose, onMove, onRename, grouping }: {
  items: TabHandle[]; selected: string; label: string; className?: string; headerClassName?: string; toolbar: ReactNode;
  listId?: string; grouping?: TabGroupController; empty?: ReactNode; menuItems?: ContextMenuItem[]; menuLabel?: string;
  leading?: ReactNode;
  tabActions?: (id: string) => ContextMenuItem[]; onBlankContext?: (anchor: import('@ui/menus/ContextMenu').MenuAnchor) => void;
  onSelect: (id: string) => void; onClose: (id: string) => void; onMove: (id: string, over: string, after: boolean) => void;
  onRename?: (id: string, title: string) => void;
}) {
  const instanceId = useId();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [blankMenu, setBlankMenu] = useState<MenuAnchor | null>(null);
  const renameFinished = useRef(false);
  const beginRename = (item: TabHandle) => {
    if (!onRename || !item.capabilities.renameable) return;
    renameFinished.current = false; setEditingId(item.id); setEditTitle(item.label);
  };
  const commitRename = () => {
    if (renameFinished.current) return;
    renameFinished.current = true;
    if (editingId && editTitle.trim()) onRename?.(editingId, editTitle.trim());
    setEditingId(null);
  };
  const cancelRename = () => { renameFinished.current = true; setEditingId(null); };
  const actionsForTab = (id: string) => {
    const items = [...(tabActions?.(id) ?? []), ...(id === selected ? menuItems ?? [] : [])];
    const labels = new Set<string>();
    return items.filter(item => { if (labels.has(item.label)) return false; labels.add(item.label); return true; });
  };
  return <div className={`folder-header ${headerClassName}`}>
    {(leading || menuItems) && <div className="folder-more">{leading ?? <EditorActions label={menuLabel} items={menuItems ?? []} />}</div>}
    <GroupedTabList items={items} selected={selected} label={label} listId={listId ?? instanceId} className={className} grouping={grouping} empty={empty}
      onSelect={onSelect} onClose={onClose} onMove={onMove} onRename={beginRename} tabActions={actionsForTab} onBlankContext={onBlankContext ?? (menuItems ? setBlankMenu : undefined)}
      render={(item, preview) => <FolderTabContent item={item} selected={selected === item.id} onSelect={preview ? undefined : onSelect} onClose={preview ? undefined : onClose}
        editing={!preview && editingId === item.id} editTitle={editTitle} setEditTitle={setEditTitle}
        onStartRename={() => beginRename(item)} onCommitRename={commitRename} onCancelRename={cancelRename} />} />
    <div className="folder-actions">{toolbar}</div>
    {blankMenu && <ContextMenu anchor={blankMenu} label={menuLabel ?? t('More editor actions')} itemRole="menuitem" items={menuItems ?? []} onClose={() => setBlankMenu(null)} />}
  </div>;
}

export function FolderTabContent({ item, selected, onSelect, onClose, editing = false, editTitle = '', setEditTitle,
  onStartRename, onCommitRename, onCancelRename,
}: {
  item: TabHandle; selected: boolean; onSelect?: (id: string) => void; onClose?: (id: string) => void;
  editing?: boolean; editTitle?: string; setEditTitle?: (title: string) => void;
  onStartRename?: () => void; onCommitRename?: () => void; onCancelRename?: () => void;
}) {
  return <div className="folder-tab-content">
    {editing ? <TextInput variant="field" data-no-drag autoFocus aria-label={t('Tab title')} className="inline-rename-input" value={editTitle}
      onChange={event => setEditTitle?.(event.target.value)} onFocus={event => event.currentTarget.select()}
      onClick={event => event.stopPropagation()} onBlur={onCommitRename} onKeyDown={event => {
        event.stopPropagation();
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
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
