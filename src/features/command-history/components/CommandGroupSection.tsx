import { useEffect, useId, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { t } from '@i18n';
import { TextButton } from '@ui/TextButton';
import { TextInput } from '@ui/TextInput';
import { IconBtn } from '@ui/UiBtn';
import { ChevronRight, Ellipsis } from '@ui/icons';
import ContextMenu, { type ContextMenuItem, type MenuAnchor } from '@ui/ContextMenu';
import HistoryColorPalette, { HistoryColorChoices } from '@ui/HistoryColorPalette';
import { historyGroupColor, isHistoryGroupColor, type HistoryGroupColor } from '@ui/historyGroupColor';
import { ListReorderPlaceholder, ListReorderZonePlaceholder, useListReorder } from '@ui/listReorder';
import type { PointerEvent } from 'react';

/** Compact command groups reuse the shared color palette and action menus. */
export default function CommandGroupSection({ id, title, count, color, visible = true, collapsed = false, onToggle, toggleLabel,
  onColor, onRename, onDelete, listId, onDrag, actions = [], renaming = false, renameValue = '', onRenameChange, onRenameCommit, onRenameCancel, children }: {
  id: string; title: string; count: number; color?: string; visible?: boolean; collapsed?: boolean; onToggle?: () => void; toggleLabel?: string;
  onColor?: (value: HistoryGroupColor | null) => void;
  onRename?: () => void; onDelete?: () => void; children: ReactNode;
  listId: string; onDrag?: (event: PointerEvent<HTMLElement>) => void; actions?: ContextMenuItem[];
  /** Inline rename: the header title becomes an input while active. */
  renaming?: boolean; renameValue?: string; onRenameChange?: (value: string) => void; onRenameCommit?: () => void; onRenameCancel?: () => void;
}) {
  const rowsId = useId();
  const [palette, setPalette] = useState<MenuAnchor | null>(null);
  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  const dragging = useListReorder(state => state.drag?.listId === listId && state.drag.id === id && state.drag.kind === 'command-history-group');
  useEffect(() => { if (!visible) { setMenu(null); setPalette(null); } }, [visible]);
  const selectedColor = isHistoryGroupColor(color) ? color : null;
  const effectiveColor = onColor ? selectedColor ?? historyGroupColor(id) : 'neutral';
  const anchorFor = (event: MouseEvent) => { const trigger = event.currentTarget as HTMLElement; const rect = trigger.getBoundingClientRect(); return { x: rect.left, y: rect.bottom + 4, trigger }; };
  const menuItems: ContextMenuItem[] = [
    ...actions,
    ...(onRename ? [{ label: t('Rename group…'), group: 'edit' as const, onClick: onRename }] : []),
    ...(onToggle ? [{ label: t(collapsed ? 'Expand group' : 'Collapse group'), group: 'view' as const, onClick: onToggle }] : []),
    ...(onDelete ? [{ label: t('Delete command group'), danger: true, onClick: onDelete }] : []),
  ];
  return <>
    {onDrag && <ListReorderPlaceholder listId={listId} itemId={id} />}
    <section className="command-history-group" data-reorder-container="" data-testid={`command-group-${id}`} data-group-color={effectiveColor}
      data-reorder-zone={id} data-reorder-kind="command-history" data-reorder-dragging={dragging ? 'true' : undefined}>
    <div className="command-history-section" data-reorder-measure="container" data-collapsible={!!onToggle} data-reorder-item={onDrag ? id : undefined}
      data-reorder-kind={onDrag ? 'command-history-group' : undefined} data-reorder-dragging={dragging ? 'true' : undefined} data-renaming={renaming ? 'true' : undefined} onPointerDown={onDrag}
      onContextMenu={event => { event.preventDefault(); event.stopPropagation(); setPalette(null); setMenu({ x: event.clientX, y: event.clientY, trigger: event.currentTarget }); }}
      style={{ '--history-group-color': effectiveColor === 'neutral' ? 'var(--text-muted)' : `var(--group-${effectiveColor})` } as CSSProperties}>
      {onColor ? <button type="button" className="history-group-marker" aria-label={t('Group color')} aria-haspopup="dialog" aria-expanded={!!palette}
        data-tip={t('Group color')} onClick={event => { setMenu(null); setPalette(anchorFor(event)); }} /> : <span className="history-group-marker" aria-hidden="true" />}
      {renaming ? (
        <span className="command-history-group-rename">
          <ChevronRight size={12} aria-hidden="true" style={{ transform: collapsed ? undefined : 'rotate(90deg)', transition: 'transform var(--dur-fast) var(--ease)' }} />
          <TextInput className="inline-rename-input" autoFocus aria-label={t('Rename command group')} value={renameValue}
            onChange={event => onRenameChange?.(event.target.value)}
            onFocus={event => event.currentTarget.select()}
            onClick={event => event.stopPropagation()}
            onBlur={onRenameCommit}
            onKeyDown={event => {
              if (event.key === 'Enter') { event.preventDefault(); onRenameCommit?.(); }
              else if (event.key === 'Escape') { event.preventDefault(); onRenameCancel?.(); }
            }} />
        </span>
      ) : (
        <TextButton className="command-history-group-title" aria-label={toggleLabel ?? title} aria-expanded={!collapsed} aria-controls={rowsId}
          onClick={onToggle} data-tip={title} data-reorder-handle={onDrag ? '' : undefined}>
          <ChevronRight size={12} style={{ transform: collapsed ? undefined : 'rotate(90deg)', transition: 'transform var(--dur-fast) var(--ease)' }} />
          <span>{title}</span>
        </TextButton>
      )}
      <span className="command-history-group-count">{count}</span>
      {menuItems.length > 0 && <IconBtn title={t('Group actions')} compact className="command-history-group-menu" aria-haspopup="menu" aria-expanded={!!menu}
        onClick={event => { setPalette(null); const anchor = anchorFor(event); setMenu(value => value ? null : anchor); }}><Ellipsis size={14} /></IconBtn>}
    </div>
    <div id={rowsId} hidden={collapsed}>{children}</div>
    <ListReorderZonePlaceholder listId={listId} zoneId={id} />
    {visible && palette && <HistoryColorPalette anchor={palette} value={selectedColor} testId={`command-group-palette-${id}`}
      onSelect={value => { onColor?.(value); setPalette(null); }} onClose={() => setPalette(null)} />}
    {visible && menu && <ContextMenu anchor={menu} label={t('Group actions')} onClose={() => setMenu(null)} items={menuItems}
      footer={onColor && <><div className="history-menu-color-label">{t('Group color')}</div>
        <HistoryColorChoices menu value={selectedColor} testId={`command-group-colors-${id}`} onSelect={value => { onColor(value); setMenu(null); }} /></>} />}
  </section>
  {onDrag && <ListReorderPlaceholder listId={listId} itemId={id} after />}
  </>;
}
