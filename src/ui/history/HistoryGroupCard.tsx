import { useId, useRef, useState, type ReactNode } from 'react';
import { t } from '@i18n';
import { ChevronRight, Ellipsis, LockSmall as Lock, Pin } from '@ui/icons';
import { historyGroupColor, type HistoryGroupColor } from '@ui/history/historyGroupColor';
import { IconButton } from '@ui/actions/IconButton';
import ContextMenu, { type ContextMenuItem, type MenuAnchor } from '@ui/menus/ContextMenu';
import HistoryColorPalette, { HistoryColorChoices } from '@ui/history/HistoryColorPalette';
import HistoryTextPrompt from '@ui/history/HistoryTextPrompt';

/** Shared settings-colored card used to visually group history rows. */
export default function HistoryGroupCard({
  id,
  title,
  subtitle,
  count,
  timestamp,
  pinned = false,
  color,
  onTogglePin,
  onSelectColor,
  originalTitle,
  note,
  onRename,
  onNote,
  lockedCount = 0,
  collapsed: controlledCollapsed,
  onCollapsedChange,
  recordActions = [],
  actions = [],
  menuDescription,
  children,
}: {
  id: string;
  title: string;
  subtitle?: string;
  count: string;
  timestamp?: number;
  /** Group is pinned to the top of its grouping mode. */
  pinned?: boolean;
  /** Manual color override; undefined keeps the automatic group color. */
  color?: HistoryGroupColor;
  onTogglePin?: () => void;
  onSelectColor?: (color: HistoryGroupColor | null) => void;
  originalTitle?: string;
  note?: string;
  onRename?: (value: string) => void;
  onNote?: (value: string) => void;
  lockedCount?: number;
  collapsed?: boolean;
  onCollapsedChange?: (value: boolean) => void;
  recordActions?: ContextMenuItem[];
  actions?: ContextMenuItem[];
  menuDescription?: string;
  children: ReactNode;
}) {
  const [localCollapsed, setLocalCollapsed] = useState(false);
  const collapsed = controlledCollapsed ?? localCollapsed;
  const setCollapsed = (value: boolean) => { setLocalCollapsed(value); onCollapsedChange?.(value); };
  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const [palette, setPalette] = useState<{ x: number; y: number } | null>(null);
  const [editor, setEditor] = useState<{ kind: 'title' | 'note'; anchor: MenuAnchor } | null>(null);
  const headingId = useId();
  const rowsId = `${headingId}-rows`;
  const date = new Date(timestamp ?? NaN);
  const hasDate = Number.isFinite(date.getTime());
  const effectiveColor = color ?? historyGroupColor(id);
  const anchorAt = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left, y: rect.bottom + 4, trigger: element };
  };
  const menuItems: ContextMenuItem[] = [
    ...actions,
    ...(onRename ? [{ label: t('Rename group…'), group: 'edit' as const, onClick: () => menu && setEditor({ kind: 'title', anchor: menu }) }] : []),
    ...(onRename && originalTitle && originalTitle !== title ? [{ label: t('Reset group title'), group: 'edit' as const, onClick: () => onRename('') }] : []),
    ...(onNote ? [{ label: t(note ? 'Edit group note…' : 'Add group note…'), group: 'edit' as const, onClick: () => menu && setEditor({ kind: 'note', anchor: menu }) }] : []),
    { label: t(collapsed ? 'Expand group' : 'Collapse group'), group: 'view', onClick: () => setCollapsed(!collapsed) },
    ...(onTogglePin ? [{ label: t(pinned ? 'Unpin group' : 'Pin group'), group: 'view' as const, onClick: onTogglePin }] : []),
    ...recordActions,
  ];

  return <section className="history-group-card" aria-labelledby={headingId} data-group-color={effectiveColor}
    data-collapsed={collapsed ? 'true' : 'false'} data-pinned={pinned ? 'true' : undefined}
    data-testid={`history-group-card-${id}`}
    onContextMenu={event => {
      if (event.target instanceof Element && event.target.closest('.history-row')) return;
      event.preventDefault(); event.stopPropagation();
      setPalette(null); setEditor(null);
      setMenu({ x: event.clientX, y: event.clientY, trigger: menuTrigger.current ?? undefined });
    }}>
    <div className="history-group-card-header">
      <div className="history-group-heading">
        {onSelectColor
          ? <button type="button" className="history-group-marker" aria-label={t('Group color')}
            aria-haspopup="dialog" aria-expanded={palette !== null} data-tip={t('Group color')}
            data-testid={`history-group-color-${id}`}
            onClick={event => { setMenu(null); setPalette(anchorAt(event.currentTarget)); }} />
          : <span className="history-group-marker" aria-hidden="true" />}
        <div className="history-group-titles"><h3 className="history-group-title" id={headingId}>
        <span className="history-group-title-text" data-tip={title}
          data-tip-description={originalTitle && originalTitle !== title ? originalTitle : undefined}
          onDoubleClick={event => onRename && setEditor({ kind: 'title', anchor: anchorAt(event.currentTarget) })}>{title}</span>
        </h3>
        {subtitle && <span className="history-group-subtitle" data-tip={subtitle}>{subtitle}</span>}</div>
      </div>
      <div className="history-group-tools">
        <div className="history-group-meta">
          {pinned && <span className="history-group-pin" data-tip={t('Pinned group')} data-testid={`history-group-pin-${id}`}>
            <Pin size={12} aria-hidden="true" />
          </span>}
          <span className="history-group-count">{count}</span>
          {lockedCount > 0 && <span className="history-group-lock" data-tip={t('{{count}} locked records', { count: lockedCount })}
            data-testid={`history-group-lock-${id}`}><Lock size={16} aria-hidden="true" /></span>}
          {hasDate && <time className="history-group-date" dateTime={date.toISOString()}>{date.toLocaleString(undefined, {
            year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
          })}</time>}
          {(onTogglePin || onSelectColor || onRename || onNote || actions.length > 0 || recordActions.length > 0) && <IconButton ref={menuTrigger} compact data-subtle className="history-group-menu-button"
            aria-label={t('Group actions')} aria-haspopup="menu" aria-expanded={menu !== null}
            data-tip={t('Group actions')} data-testid={`history-group-menu-${id}`}
            onClick={event => { setPalette(null); setEditor(null); const anchor = anchorAt(event.currentTarget); setMenu(current => current ? null : anchor); }}>
            <Ellipsis size={14} aria-hidden="true" />
          </IconButton>}
          <IconButton compact data-subtle className="history-group-toggle" aria-expanded={!collapsed} aria-controls={rowsId}
            aria-label={title} data-tip={title} data-testid={`history-group-toggle-${id}`} onClick={() => setCollapsed(!collapsed)}>
            <ChevronRight size={14} aria-hidden="true" data-collapsed={collapsed ? 'true' : 'false'} />
          </IconButton>
        </div>
      </div>
    </div>
    {menu && <ContextMenu anchor={menu} itemRole="menuitem" onClose={() => setMenu(null)} items={menuItems} label={t('Group actions')}
      footer={onSelectColor && <>
        <div className="history-menu-color-label">{t('Group color')}</div>
        <HistoryColorChoices menu value={color ?? null} testId={`history-group-menu-colors-${id}`}
          onSelect={value => { onSelectColor(value); menu.trigger?.focus(); setMenu(null); }} />
      </>}
      description={menuDescription ?? t('Actions apply to the matching records in this group. Locked records cannot be deleted.')} />}
    {editor && <HistoryTextPrompt anchor={editor.anchor}
      label={t(editor.kind === 'title' ? 'Group title' : 'Group note')}
      placeholder={editor.kind === 'title' ? (originalTitle ?? title) : t('Write a note…')}
      value={editor.kind === 'title' ? title : (note ?? '')} multiline={editor.kind === 'note'} saveLabel={t('Save')}
      testId={`history-group-${editor.kind}-${id}`}
      onSave={value => editor.kind === 'title' ? onRename?.(value) : onNote?.(value)} onClose={() => setEditor(null)} />}
    {palette && <HistoryColorPalette anchor={palette} value={color ?? null} testId={`history-group-palette-${id}`}
      onSelect={value => { onSelectColor?.(value); setPalette(null); }} onClose={() => setPalette(null)} />}
    {note && <p className="history-group-note">{note}</p>}
    {!collapsed && <div className="history-group-card-rows" id={rowsId}>{children}</div>}
  </section>;
}
