import { Fragment, type ReactNode } from 'react';
import { menuGroup, orderMenuItems, type MenuGroup } from './menuGroups';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { MenuItem } from '@ui/UiBtn';
import { useExclusiveMenu } from './hooks/useExclusiveMenu';
import { useFloatingPanelPosition } from './hooks/useFloatingPanelPosition';
import { t } from '@i18n';

export interface MenuAnchor {
  x: number;
  y: number;
  trigger?: HTMLElement;
}

export interface ContextMenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
  group?: MenuGroup;
  order?: number;
  disabled?: boolean;
  /** Optional keyboard shortcut displayed at the end of the row. */
  shortcut?: string;
  /** Radio/switch state; renders a leading mark and exposes menuitemradio semantics. */
  checked?: boolean;
}

interface Props {
  anchor: MenuAnchor;
  items: ContextMenuItem[];
  onClose: () => void;
  label?: string;
  description?: string;
  itemRole?: 'menuitem';
  footer?: ReactNode;
}

/** Shared action menu with viewport placement and keyboard navigation. */
export default function ContextMenu({ anchor, items, onClose, label = t('Action menu'), description, itemRole, footer }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useExclusiveMenu(ref, onClose, anchor.trigger);
  const position = useFloatingPanelPosition(ref, anchor);
  const closeWithFocus = () => { anchor.trigger?.focus(); onClose(); };

  useLayoutEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, []);

  // Capture Escape so closing an action menu does not affect the workspace below it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      anchor.trigger?.focus();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, anchor.trigger]);

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      className="workspace-floating"
      onContextMenu={event => { event.preventDefault(); event.stopPropagation(); }}
      onKeyDown={event => {
        if (event.key === 'Tab') { closeWithFocus(); return; }
        if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
        if (!buttons.length) return;
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
          : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }}
      style={{
        position: 'fixed',
        zIndex: 9999,
        top: position.top,
        left: position.left,
        width: 'max-content',
        minWidth: 'min(180px, calc(100vw - 16px))',
        maxWidth: 'calc(100vw - 16px)',
        maxHeight: 'calc(100vh - 16px)',
        overflowY: 'auto',
        boxSizing: 'border-box',
        padding: 4,
        fontSize: 'calc(12px * var(--ui-font-scale))',
      }}
    >
      {description && <div className="context-menu-description">{description}</div>}
      <ContextMenuItems items={items} onClose={closeWithFocus} itemRole={itemRole} />
      {footer && <><div role="separator" className="context-menu-separator" /><div className="context-menu-footer">{footer}</div></>}
    </div>,
    document.body,
  );
}

/** All action menus share ordering, group boundaries and row controls. */
export function ContextMenuItems({ items, onClose, itemRole }: { items: ContextMenuItem[]; onClose: () => void; itemRole?: 'menuitem' }) {
  const ordered = orderMenuItems(items);
  // Menus that show radio marks keep one mark column so every label starts at the same x.
  const indent = ordered.some((item) => item.checked !== undefined);
  return <>{ordered.map((item, index) => <Fragment key={`${menuGroup(item)}-${item.label}`}>
    {index > 0 && menuGroup(item) !== menuGroup(ordered[index - 1]!) && <div role="separator" className="context-menu-separator" />}
    <MenuItem role={itemRole} disabled={item.disabled} label={item.label} danger={item.danger ?? item.group === 'danger'} shortcut={item.shortcut} checked={item.checked} indent={indent} onClick={() => { item.onClick(); onClose(); }} />
  </Fragment>)}</>;
}
