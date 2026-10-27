import { Fragment, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { t } from '@i18n';
import ContextMenu, { type ContextMenuItem, type MenuAnchor } from '@ui/menus/ContextMenu';
import InlineRenameInput from '@ui/fields/InlineRenameInput';
import ConfirmDialog from '@ui/feedback/ConfirmDialog';
import { HistoryColorChoices } from '@ui/history/HistoryColorPalette';
import { historyGroupColor, isHistoryGroupColor } from '@ui/history/historyGroupColor';
import { ListReorderPlaceholder, ListReorderPreview, ListReorderZonePlaceholder, useListReorder, useListReorderDrag } from './listReorder';
import { useHorizontalWheel } from '../hooks/useHorizontalWheel';
import { useActiveTabVisibility } from '../hooks/useActiveTabVisibility';
import type { TabHandle } from './tabHandle';
import type { TabGroupController, TabGroupHandle } from './tabGroups';

/** One tab/group renderer and reorder mechanic for every functional workspace. */
export default function GroupedTabList({ items, selected, label, listId, className, grouping, empty, tabActions: extraTabActions, onBlankContext, onSelect, onClose, onMove, onRename, render }: {
  items: TabHandle[]; selected: string; label: string; listId: string; className: string;
  grouping?: TabGroupController; empty?: ReactNode; onSelect: (id: string) => void; onClose: (id: string) => void;
  onMove: (id: string, over: string, after: boolean) => void; onRename: (item: TabHandle) => void;
  render: (item: TabHandle, preview?: boolean) => ReactNode;
  tabActions?: (id: string) => ContextMenuItem[]; onBlankContext?: (anchor: MenuAnchor) => void;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ anchor: MenuAnchor; tab?: TabHandle; group?: TabGroupHandle } | null>(null);
  const [name, setName] = useState('');
  const [hovered, setHovered] = useState<string | null>(null);
  const [newGroupId, setNewGroupId] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{ group: TabGroupHandle; mode: 'delete' | 'archive' } | null>(null);
  const groups = grouping?.groups ?? [];
  const drag = useListReorder(state => state.drag?.listId === listId ? state.drag : null);
  const dwell = useListReorder(state => state.drag?.listId === listId ? state.dwellZoneId : null);
  useHorizontalWheel(strip, true);
  useActiveTabVisibility(strip, '[data-active="true"], [data-group-anchor="true"]', `${selected}:${items.length}:${JSON.stringify(groups)}`);
  const groupFor = (id: string) => groups.find(group => group.members.includes(id));
  const knownEntities = [...groups.map(group => `group:${group.id}`), ...items.filter(item => !groupFor(item.id)).map(item => `tab:${item.id}`)];
  const entities = [...new Set([...(grouping?.order ?? []).filter(id => knownEntities.includes(id)), ...knownEntities])];
  const start = useListReorderDrag({ listId, axis: 'horizontal', grouped: groups.length > 0, endZoneId: 'ungrouped',
    accepts: () => true, onDrop: (moving, target) => {
    if (moving.kind === 'group') {
      if (target?.itemId) grouping?.move(moving.id, target.itemId, !!target.after);
      else if (target?.zoneId === 'ungrouped') grouping?.move(moving.id, undefined, false);
      return;
    }
    if (target?.itemId && items.some(item => item.id === target.itemId)) onMove(moving.id, target.itemId, !!target.after);
    else if (target?.itemId && groups.some(group => group.id === target.itemId)) { grouping?.assign(moving.id); grouping?.move(moving.id, target.itemId, !!target.after); }
    else if (target?.zoneId) grouping?.assign(moving.id, target.zoneId === 'ungrouped' ? undefined : target.zoneId);
  } });
  const openGroup = (group: TabGroupHandle, anchor: MenuAnchor) => { setName(group.title); setMenu({ group, anchor }); };
  useEffect(() => {
    if (!newGroupId) return;
    const group = groups.find(group => group.id === newGroupId);
    const trigger = Array.from(strip.current?.querySelectorAll<HTMLElement>('[data-group-header-id]') ?? []).find(element => element.dataset.groupHeaderId === newGroupId);
    if (!group || !trigger) return;
    const bounds = trigger.getBoundingClientRect(); openGroup(group, { x: bounds.left, y: bounds.bottom, trigger }); setNewGroupId(null);
  }, [newGroupId, groups]);
  const closeMenu = () => {
    if (menu?.group && name.trim() && name.trim() !== menu.group.title) grouping?.rename(menu.group.id, name.trim());
    setMenu(null);
  };
  const context = (item: TabHandle, anchor: MenuAnchor) => setMenu({ tab: item, anchor });
  const row = (item: TabHandle) => <Fragment key={item.id}>
    <ListReorderPlaceholder listId={listId} itemId={item.id} />
    <div {...item.dataAttributes} className={`folder-tab${listId === 'session-tabs' ? ' terminal-instance-tab' : ''}`} data-active={selected === item.id}
      data-reorder-item={item.id} data-reorder-kind={groupFor(item.id) ? 'tab' : 'loose-tab'} data-reorder-dragging={drag?.id === item.id ? 'true' : undefined} data-tab-surface={item.surface}
      onPointerDown={event => {
        if (event.button !== 0 || event.isPrimary === false || (event.target as Element).closest('input, [data-no-drag]')) return;
        start(event, { id: item.id, kind: groupFor(item.id) ? 'tab' : 'loose-tab' });
        if (listId === 'session-tabs') event.preventDefault();
        if (selected !== item.id) onSelect(item.id);
      }}
      onContextMenu={event => { event.preventDefault(); event.stopPropagation(); context(item, { x: event.clientX, y: event.clientY, trigger: event.currentTarget }); }}
      onKeyDown={event => {
        if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
        event.preventDefault(); const box = event.currentTarget.getBoundingClientRect(); context(item, { x: box.left, y: box.bottom, trigger: event.currentTarget });
      }}>{render(item)}</div>
    <ListReorderPlaceholder listId={listId} itemId={item.id} after />
  </Fragment>;
  const tabActions = (item: TabHandle): ContextMenuItem[] => {
    const group = groupFor(item.id);
    return [
      ...(grouping && item.capabilities.groupable ? [
        { label: t('Create tab group'), group: 'organize' as const, onClick: () => { void Promise.resolve(grouping.create(item.id)).then(id => { if (id) setNewGroupId(id); }); } },
        ...(groups.length ? [{ label: t('Move to tab group'), group: 'organize' as const, submenu: { items: groups.map(group => ({ label: group.title, onClick: () => grouping.assign(item.id, group.id) })) } }] : []),
        ...(group ? [{ label: t('Remove from tab group'), group: 'organize' as const, onClick: () => grouping.assign(item.id) }] : []),
      ] : []),
      ...(item.capabilities.renameable ? [{ label: t('Rename tab'), onClick: () => onRename(item) }] : []),
      ...(extraTabActions?.(item.id) ?? []),
      { label: t('Close this tab'), danger: true, onClick: () => onClose(item.id) },
    ];
  };
  const groupActions = (group: TabGroupHandle): ContextMenuItem[] => [
    ...(grouping?.add ? [{ label: t('Add terminal to group'), onClick: () => grouping.add?.(group.id) }] : []),
    { label: t(group.collapsed ? 'Expand group' : 'Collapse group'), onClick: () => grouping?.collapse(group.id, !group.collapsed) },
    { label: t('Archive tab group'), group: 'danger', onClick: () => setConfirmation({ group, mode: 'archive' }) },
    { label: t('Delete tab group'), group: 'danger', danger: true, onClick: () => setConfirmation({ group, mode: 'delete' }) },
  ];
  return <>
    <div ref={strip} className={`folder-tab-list ${className}`} role="tablist" aria-label={label} data-reorder-list={listId}
      onContextMenu={event => { event.preventDefault(); onBlankContext?.({ x: event.clientX, y: event.clientY, trigger: event.currentTarget }); }}
      onKeyDown={event => {
        if ((event.target as Element).closest('input') || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement); if (index < 0) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length;
        buttons[next]?.focus(); buttons[next]?.click();
      }}>
      {entities.map(entity => {
        if (entity.startsWith('tab:')) { const item = items.find(item => item.id === entity.slice(4)); return item && row(item); }
        const group = groups.find(group => group.id === entity.slice(6)); if (!group) return null;
        const color = grouping?.colors[group.id] ?? historyGroupColor(group.id);
        const collapsed = group.collapsed || drag?.id === group.id;
        return <Fragment key={group.id}>
          <ListReorderPlaceholder listId={listId} itemId={group.id} />
          <div className="terminal-tab-group" data-group-color={color} data-group-card="true" data-group-collapsed={collapsed ? 'true' : undefined} data-group-dragging={drag?.id === group.id ? 'true' : undefined} data-drop-into={dwell === group.id ? 'true' : undefined}
            onMouseEnter={() => setHovered(group.id)} onMouseLeave={() => setHovered(null)}
            style={{ '--terminal-group-color': color === 'neutral' ? 'var(--text-secondary)' : `var(--group-${color})` } as CSSProperties}>
            <div className="tab-group-container" data-reorder-container="" data-group-id={group.id} data-reorder-zone={group.id} data-reorder-kind="tab">
              <button className="folder-tab tab-group-header" data-reorder-handle data-group-header-id={group.id} data-group-anchor={group.members.includes(selected) || undefined} data-testid={`group-header-${group.id}`}
                data-reorder-item={group.id} data-reorder-kind="group" data-reorder-measure="container" data-tab-surface={collapsed && (group.members.includes(selected) || hovered === group.id || drag?.id === group.id) ? 'true' : undefined}
                aria-label={group.title} aria-expanded={!collapsed} data-tip={t('Collapse or expand group · Right-click to rename · Drag to reorder')}
                onClick={() => grouping?.collapse(group.id, !group.collapsed)} onPointerDown={event => { if (event.button === 0) start(event, { id: group.id, kind: 'group' }); }}
                onContextMenu={event => { event.preventDefault(); event.stopPropagation(); openGroup(group, { x: event.clientX, y: event.clientY, trigger: event.currentTarget }); }}
                onKeyDown={event => { if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') { event.preventDefault(); const box = event.currentTarget.getBoundingClientRect(); openGroup(group, { x: box.left, y: box.bottom, trigger: event.currentTarget }); } }}>
                <span className="terminal-group-chip" data-testid={`group-title-${group.id}`}><span>{group.title}</span></span>
              </button>
              {!collapsed && items.filter(item => group.members.includes(item.id)).map(row)}
            </div>
          </div>
          <ListReorderPlaceholder listId={listId} itemId={group.id} after />
          {(collapsed || !group.members.length) && <ListReorderZonePlaceholder listId={listId} zoneId={group.id} />}
        </Fragment>;
      })}
      {!items.length && empty}
      {grouping && <div data-reorder-zone="ungrouped" data-reorder-kind="loose-tab" className="terminal-ungrouped-tail"><ListReorderZonePlaceholder listId={listId} zoneId="ungrouped" /></div>}
    </div>
    <ListReorderPreview listId={listId} variant="item" owner={strip} className="terminal-group-reorder-preview">{moving => {
      const item = items.find(item => item.id === moving.id);
      if (item) return <div className="folder-tab folder-tab-preview" data-active={selected === item.id} data-tab-surface={item.surface}>{render(item, true)}</div>;
      return <div className="terminal-tab-group terminal-group-preview"><div className="folder-tab tab-group-header" data-tab-surface="true"><span className="terminal-group-chip">{groups.find(group => group.id === moving.id)?.title}</span></div></div>;
    }}</ListReorderPreview>
    {menu && <ContextMenu anchor={menu.anchor} label={t(menu.group ? 'Group actions' : 'Tab actions')} onClose={closeMenu} onCancel={() => setMenu(null)}
      header={menu.group && <InlineRenameInput variant="field" aria-label={t('Group title')} value={name} onChange={event => setName(event.target.value)} onFocus={event => event.currentTarget.select()}
        onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); closeMenu(); menu.anchor.trigger?.focus(); } }} />}
      items={menu.group ? groupActions(menu.group) : menu.tab ? tabActions(menu.tab) : []}
      footer={menu.group && <><div className="history-menu-color-label">{t('Group color')}</div><HistoryColorChoices menu
        value={isHistoryGroupColor(grouping?.colors[menu.group.id]) ? grouping!.colors[menu.group.id] as ReturnType<typeof historyGroupColor> : null}
        testId="terminal-group-color" onSelect={value => { grouping?.color(menu.group!.id, value); closeMenu(); menu.anchor.trigger?.focus(); }} /></>} />}
    {confirmation && createPortal(<ConfirmDialog open title={t(confirmation.mode === 'delete' ? 'Delete tab group' : 'Archive tab group')}
      message={t(confirmation.mode === 'delete' ? 'Delete group "{{name}}" and every item in it?' : 'Archive group "{{name}}"? Its tabs will close and move to session history.', { name: confirmation.group.title })}
      confirmLabel={t(confirmation.mode === 'delete' ? 'Delete group' : 'Archive tab group')} cancelLabel={t('Cancel')} danger={confirmation.mode === 'delete'}
      onCancel={() => setConfirmation(null)} onConfirm={() => { grouping?.remove(confirmation.group.id, confirmation.mode); setConfirmation(null); }} />, document.body)}
  </>;
}
