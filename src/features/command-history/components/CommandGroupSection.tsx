import { useEffect, useId, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { t } from '@i18n';
import { TextButton } from '@ui/actions/TextButton';
import { TextInput } from '@ui/fields/TextInput';
import { IconBtn } from '@ui/actions/UiBtn';
import { ChevronRight, Ellipsis } from '@ui/icons';
import ContextMenu, { type ContextMenuItem, type MenuAnchor } from '@ui/menus/ContextMenu';
import HistoryColorPalette, { HistoryColorChoices } from '@ui/history/HistoryColorPalette';
import { historyGroupColor, isHistoryGroupColor, type HistoryGroupColor } from '@ui/history/historyGroupColor';
import { ListReorderPlaceholder, ListReorderZonePlaceholder, useListReorder } from '@ui/layout/listReorder';
import type { PointerEvent } from 'react';

/** Compact command groups reuse the shared color palette and action menus. */
export default function CommandGroupSection({ id, title, count, color, visible = true, collapsed = false, onToggle, toggleLabel,
  onColor, onDelete, listId, onDrag, actions = [], renaming = false, onRenameGroup, onRenameCancel, children }: {
  id: string; title: string; count: number; color?: string; visible?: boolean; collapsed?: boolean; onToggle?: () => void; toggleLabel?: string;
  onColor?: (value: HistoryGroupColor | null) => void;
  onDelete?: () => void; children: ReactNode;
  listId: string; onDrag?: (event: PointerEvent<HTMLElement>) => void; actions?: ContextMenuItem[];
  /** Renaming lives in the action menu's header input, matching tab groups. */
  renaming?: boolean; onRenameGroup?: (title: string) => void; onRenameCancel?: () => void;
}) {
  const rowsId = useId();
  const header = useRef<HTMLDivElement>(null);
  const [name, setName] = useState(title);
  const [palette, setPalette] = useState<MenuAnchor | null>(null);
  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  const dragging = useListReorder(state => state.drag?.listId === listId && state.drag.id === id && state.drag.kind === 'command-history-group');
  useEffect(() => { if (!visible) { setMenu(null); setPalette(null); } }, [visible]);
  const selectedColor = isHistoryGroupColor(color) ? color : null;
  const effectiveColor = onColor ? selectedColor ?? historyGroupColor(id) : 'neutral';
  const anchorFor = (event: MouseEvent) => { const trigger = event.currentTarget as HTMLElement; const rect = trigger.getBoundingClientRect(); return { x: rect.left, y: rect.bottom + 4, trigger }; };
  const openMenu = (anchor: MenuAnchor) => { setName(title); setPalette(null); setMenu(anchor); };
  const closeMenu = () => {
    const next = name.trim();
    if (next && next !== title) onRenameGroup?.(next);
    setMenu(null);
  };
  useEffect(() => {
    if (!renaming || !header.current) return;
    const trigger = header.current;
    const rect = trigger.getBoundingClientRect();
    openMenu({ x: rect.left, y: rect.bottom + 4, trigger });
    onRenameCancel?.();
  }, [renaming, title, onRenameCancel]);
  const menuItems: ContextMenuItem[] = [
    ...actions,
    ...(onToggle ? [{ label: t(collapsed ? 'Expand group' : 'Collapse group'), group: 'view' as const, onClick: onToggle }] : []),
    ...(onDelete ? [{ label: t('Delete command group'), danger: true, onClick: onDelete }] : []),
  ];
  return <>
    {onDrag && <ListReorderPlaceholder listId={listId} itemId={id} />}
    <section className="command-history-group" data-reorder-container="" data-testid={`command-group-${id}`} data-group-color={effectiveColor}
      data-reorder-zone={id} data-reorder-kind="command-history" data-reorder-dragging={dragging ? 'true' : undefined}>
    <div ref={header} className="command-history-section" data-reorder-measure="container" data-collapsible={!!onToggle} data-reorder-item={onDrag ? id : undefined}
      data-reorder-kind={onDrag ? 'command-history-group' : undefined} data-reorder-dragging={dragging ? 'true' : undefined} onPointerDown={onDrag}
      onContextMenu={event => { event.preventDefault(); event.stopPropagation(); openMenu({ x: event.clientX, y: event.clientY, trigger: event.currentTarget }); }}
      style={{ '--history-group-color': effectiveColor === 'neutral' ? 'var(--text-muted)' : `var(--group-${effectiveColor})` } as CSSProperties}>
      {onColor ? <button type="button" className="history-group-marker" aria-label={t('Group color')} aria-haspopup="dialog" aria-expanded={!!palette}
        data-tip={t('Group color')} onClick={event => { setMenu(null); setPalette(anchorFor(event)); }} /> : <span className="history-group-marker" aria-hidden="true" />}
      <TextButton className="command-history-group-title" aria-label={toggleLabel ?? title} aria-expanded={!collapsed} aria-controls={rowsId}
        onClick={onToggle} data-tip={title} data-reorder-handle={onDrag ? '' : undefined}>
        <ChevronRight size={12} style={{ transform: collapsed ? undefined : 'rotate(90deg)', transition: 'transform var(--dur-fast) var(--ease)' }} />
        <span>{title}</span>
      </TextButton>
      <span className="command-history-group-count">{count}</span>
      {menuItems.length > 0 && <IconBtn title={t('Group actions')} compact className="command-history-group-menu" aria-haspopup="menu" aria-expanded={!!menu}
        onClick={event => { const anchor = anchorFor(event); if (menu) setMenu(null); else openMenu(anchor); }}><Ellipsis size={14} /></IconBtn>}
    </div>
    <div id={rowsId} hidden={collapsed}>{children}</div>
    <ListReorderZonePlaceholder listId={listId} zoneId={id} />
    {visible && palette && <HistoryColorPalette anchor={palette} value={selectedColor} testId={`command-group-palette-${id}`}
      onSelect={value => { onColor?.(value); setPalette(null); }} onClose={() => setPalette(null)} />}
    {visible && menu && <ContextMenu anchor={menu} label={t('Group actions')} onClose={closeMenu} onCancel={() => setMenu(null)}
      header={onRenameGroup ? <TextInput variant="field" aria-label={t('Rename command group')} value={name}
        onChange={event => setName(event.target.value)}
        onFocus={event => event.currentTarget.select()}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); closeMenu(); menu.trigger?.focus(); } }} /> : undefined}
      items={menuItems}
      footer={onColor && <><div className="history-menu-color-label">{t('Group color')}</div>
        <HistoryColorChoices menu value={selectedColor} testId={`command-group-colors-${id}`} onSelect={value => { onColor(value); setMenu(null); }} /></>} />}
  </section>
  {onDrag && <ListReorderPlaceholder listId={listId} itemId={id} after />}
  </>;
}
