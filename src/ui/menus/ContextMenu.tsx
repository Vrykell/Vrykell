import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { menuGroup, orderMenuItems, type MenuGroup } from '@ui/menus/menuGroups';
import { MenuItem } from '@ui/actions/UiBtn';
import { hasOwnedListbox, useExclusiveMenu } from '../hooks/useExclusiveMenu';
import { useFloatingPanelPosition } from '../hooks/useFloatingPanelPosition';
import { t } from '@i18n';
import { useListNavigationMode } from '../hooks/useListNavigationMode';

export interface MenuAnchor { x: number; y: number; trigger?: HTMLElement; above?: HTMLElement; align?: 'start' | 'end' }
export interface ContextMenuItem {
  label: string;
  onClick?: () => void;
  danger?: boolean;
  group?: MenuGroup;
  order?: number;
  disabled?: boolean;
  shortcut?: string;
  checked?: boolean;
  submenu?: { items: ContextMenuItem[] };
}
interface Props {
  anchor: MenuAnchor; items: ContextMenuItem[]; onClose: () => void;
  label?: string; description?: string; itemRole?: 'menuitem'; header?: ReactNode; footer?: ReactNode; onCancel?: () => void;
}
interface OpenSubmenu { item: ContextMenuItem; trigger: HTMLButtonElement; focus: boolean }

/** One menu tree owns outside presses and keyboard focus, including all nested surfaces. */
export default function ContextMenu({ anchor, items, onClose, label = t('Action menu'), description, itemRole, header, footer, onCancel }: Props) {
  const tree = useRef<HTMLDivElement>(null);
  const [path, setPath] = useState<OpenSubmenu[]>([]);
  const id = useId();
  useExclusiveMenu(tree, onClose, anchor.trigger);
  const close = () => { anchor.trigger?.focus(); onClose(); };
  const closeLevel = () => setPath(previous => {
    previous[previous.length - 1]?.trigger.focus(); return previous.slice(0, -1);
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (hasOwnedListbox(tree.current)) return;
      event.preventDefault(); event.stopPropagation();
      if (path.length) closeLevel(); else { anchor.trigger?.focus(); (onCancel ?? onClose)(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [path.length, anchor.trigger, onClose, onCancel]);
  const open = (level: number, item: ContextMenuItem, trigger: HTMLButtonElement, focus: boolean) => {
    setPath(previous => [...previous.slice(0, level), { item, trigger, focus }]);
  };
  const rows = (entries: ContextMenuItem[], level: number) => <ContextMenuItems items={entries} onClose={close} itemRole={itemRole}
    submenuId={`${id}-${level}`} openLabel={path[level]?.item.label}
    onHover={(item, trigger) => {
      if (item.submenu && !item.disabled) open(level, item, trigger, false);
      else setPath(previous => previous.length > level ? previous.slice(0, level) : previous);
    }} onOpen={(item, trigger) => open(level, item, trigger, true)} />;
  return createPortal(<div ref={tree}>
    <MenuSurface anchor={anchor} label={label} focus onClose={close}>
      {header && <div className="context-menu-header">{header}</div>}
      {description && <div className="context-menu-description">{description}</div>}
      {rows(items, 0)}
      {footer && <><div role="separator" className="context-menu-separator" /><div className="context-menu-footer">{footer}</div></>}
    </MenuSurface>
    {path.map((entry, index) => <MenuSurface key={`${index}-${entry.item.label}`} id={`${id}-${index}`} anchor={anchor}
      submenuOf={entry.trigger} label={entry.item.label} focus={entry.focus} onClose={close} onBack={() => {
        entry.trigger.focus(); setPath(previous => previous.slice(0, index));
      }}>
      {rows(entry.item.submenu?.items ?? [], index + 1)}
    </MenuSurface>)}
  </div>, document.body);
}

function MenuSurface({ anchor, submenuOf, label, focus, children, onClose, onBack, id }: {
  anchor: MenuAnchor; submenuOf?: HTMLElement; label: string; focus: boolean; children: ReactNode;
  onClose: () => void; onBack?: () => void; id?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const navigation = useListNavigationMode(true);
  const position = useFloatingPanelPosition(ref, anchor, submenuOf);
  useLayoutEffect(() => { if (focus) ref.current?.querySelector<HTMLElement>('input:not(:disabled), button:not(:disabled)')?.focus(); }, [focus]);
  return <div {...navigation.props} ref={ref} id={id} role="menu" aria-label={label} className="workspace-floating context-menu-surface"
    onContextMenu={event => { event.preventDefault(); event.stopPropagation(); }}
    onKeyDown={event => {
      if (event.ctrlKey || event.metaKey) return;
      if (event.target instanceof Element && event.target.matches('input, textarea, [contenteditable="true"], [role="combobox"]')) { event.stopPropagation(); return; }
      if (event.key === 'Enter' || event.key === ' ') { event.stopPropagation(); return; }
      if (event.key === 'Tab') { onClose(); return; }
      if (event.key === 'ArrowLeft' && onBack) { event.preventDefault(); event.stopPropagation(); onBack(); return; }
      if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
      if (!buttons.length) return;
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
        : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }} style={{ ...position, position: 'fixed', zIndex: 9999, width: 'max-content', minWidth: 'min(180px, calc(100vw - 16px))',
      maxWidth: 'calc(100vw - 16px)', maxHeight: position.maxHeight ?? 'calc(100vh - 16px)', overflowY: 'auto', boxSizing: 'border-box', padding: 4,
      fontSize: 'calc(12px * var(--ui-font-scale))' }}>{children}</div>;
}

/** All action menus share ordering, group boundaries and row controls. */
export function ContextMenuItems({ items, onClose, itemRole, onOpen, onHover, openLabel, submenuId }: {
  items: ContextMenuItem[]; onClose: () => void; itemRole?: 'menuitem'; openLabel?: string; submenuId?: string;
  onOpen?: (item: ContextMenuItem, trigger: HTMLButtonElement) => void;
  onHover?: (item: ContextMenuItem, trigger: HTMLButtonElement) => void;
}) {
  const ordered = orderMenuItems(items);
  return <>{ordered.map((item, index) => <Fragment key={`${menuGroup(item)}-${item.label}`}>
    {index > 0 && menuGroup(item) !== menuGroup(ordered[index - 1]!) && <div role="separator" className="context-menu-separator" />}
    <MenuItem role={item.submenu ? 'menuitem' : itemRole} disabled={item.disabled} label={item.label} danger={item.danger ?? item.group === 'danger'}
      shortcut={item.shortcut} checked={item.checked} submenu={!!item.submenu} expanded={openLabel === item.label} controls={submenuId}
      onPointerEnter={event => onHover?.(item, event.currentTarget)}
      onKeyDown={event => { if (event.key === 'ArrowRight' && item.submenu) { event.preventDefault(); event.stopPropagation(); onOpen?.(item, event.currentTarget); } }}
      onClick={event => { if (item.submenu) onOpen?.(item, event.currentTarget); else { item.onClick?.(); onClose(); } }} />
  </Fragment>)}</>;
}
