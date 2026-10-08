import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { Check } from '@ui/icons';

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
}

export default function CheckboxMenu<Id extends string>({ title, options, onToggle, onClose, style }: CheckboxMenuProps<Id>) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
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
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={title}
      className="workspace-floating"
      style={{ position: 'absolute', padding: 4, zIndex: 200, minWidth: 180, ...style }}
    >
      <div style={{
        padding: '6px 12px',
        fontSize: 'calc(11px * var(--ui-font-scale))',
        color: 'var(--text-muted)',
        fontWeight: 'var(--fw-semibold)',
      }}>
        {title}
      </div>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="menuitemcheckbox"
          aria-checked={option.checked}
          className="workspace-floating-row"
          onClick={() => onToggle(option.id)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
            padding: '6px 12px', border: 'none', background: 'transparent',
            color: option.checked ? 'var(--text-primary)' : 'var(--text-muted)',
            cursor: 'pointer', fontSize: 'calc(12px * var(--ui-font-scale))', fontFamily: 'var(--font-ui)',
          }}
        >
          <span aria-hidden="true" style={{
            width: 16, height: 16, borderRadius: 3,
            border: `1.5px solid ${option.checked ? 'var(--accent)' : 'var(--border)'}`,
            background: option.checked ? 'var(--accent)' : 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--accent-text)', flexShrink: 0,
          }}>
            {option.checked ? <Check size={10} /> : ''}
          </span>
          <span style={{ flex: 1, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            {option.icon}{option.label}
          </span>
          {option.count !== undefined && option.count > 0 && (
            <span style={{
              fontSize: 'calc(10px * var(--ui-font-scale))',
              color: 'var(--text-muted)',
              background: 'var(--canvas)',
              padding: '0 6px',
              borderRadius: 8,
            }}>
              {option.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
