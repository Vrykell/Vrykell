import { useEffect, useRef, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { Checkbox } from './Checkbox';

/**
 * CheckboxMenu — a themed multi-select list used by floating filters.
 *
 * Selecting an item toggles it and keeps the menu open, so several items can be
 * changed in one pass; the menu closes only when it loses focus (an outside
 * pointer press or Escape).
 */

export interface CheckboxMenuOption<Id extends string = string> {
  id: Id;
  label: string;
  displayLabel?: ReactNode;
  checked: boolean;
  /** Optional leading icon (e.g. a search source mark). */
  icon?: ReactNode;
  /** Optional trailing count badge; hidden when zero/undefined. */
  count?: number;
}

export interface CheckboxMenuProps<Id extends string = string> {
  /** Heading shown above the list. */
  title: string;
  options: readonly CheckboxMenuOption<Id>[];
  onToggle: (id: Id) => void;
  onClose: () => void;
  /** Placement of the floating panel (usually relative to its trigger). */
  style?: CSSProperties;
  /** Compact shortcut menus omit the heading and use row selection as their check mark. */
  compact?: boolean;
  footer?: ReactNode;
  triggerRef?: RefObject<HTMLElement | null>;
}

export default function CheckboxMenu<Id extends string>({ title, options, onToggle, onClose, style, compact = false, footer, triggerRef }: CheckboxMenuProps<Id>) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node) && !triggerRef?.current?.contains(event.target as Node)) onClose();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    // Register one tick late so the click that opened the menu does not close it.
    const timer = setTimeout(() => document.addEventListener('pointerdown', outside), 0);
    document.addEventListener('keydown', key);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', key);
    };
  }, [onClose, triggerRef]);

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={title}
      className={`workspace-floating${compact ? ' checkbox-menu-compact' : ''}`}
      style={{ position: 'absolute', padding: 4, zIndex: 200, minWidth: 180, ...style }}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return; }
        if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }}
    >
      {!compact && <div style={{
        padding: '6px 12px',
        fontSize: 'calc(11px * var(--ui-font-scale))',
        color: 'var(--text-muted)',
        fontWeight: 'var(--fw-semibold)',
      }}>
        {title}
      </div>}
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          data-subtle
          role="menuitemcheckbox"
          aria-label={option.label}
          aria-checked={option.checked}
          className="workspace-floating-row"
          onClick={event => { event.currentTarget.focus(); onToggle(option.id); }}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
            padding: '6px 12px', border: 'none',
            color: option.checked ? 'var(--text-primary)' : 'var(--text-muted)',
            cursor: 'pointer', fontSize: 'calc(12px * var(--ui-font-scale))', fontFamily: 'var(--font-ui)',
          }}
        >
          {!compact && <Checkbox checked={option.checked} readOnly tabIndex={-1} aria-hidden="true" style={{ pointerEvents: 'none' }} />}
          <span style={{ flex: 1, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            {option.icon}{option.displayLabel ?? option.label}
          </span>
          {option.count !== undefined && option.count > 0 && (
            <span style={{
              fontSize: 'calc(10px * var(--ui-font-scale))',
              color: 'var(--text-muted)',
              background: 'var(--hover)',
              padding: '0 6px',
              borderRadius: 8,
            }}>
              {option.count}
            </span>
          )}
        </button>
      ))}
      {footer}
    </div>
  );
}
