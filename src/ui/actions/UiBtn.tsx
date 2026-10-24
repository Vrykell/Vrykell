import KeyHint from '@ui/feedback/KeyHint';
import { Check, ChevronRight } from '@ui/icons';
import { IconButton } from '@ui/actions/IconButton';
import { TextButton } from '@ui/actions/TextButton';
/** Shared themed controls and formatting helpers. */

import type { CSSProperties, MouseEvent, KeyboardEvent } from 'react';

// Compact text controls share the same hover and focus rules.

interface HBtnProps {
  title: string;
  onClick: (e: MouseEvent) => void;
  children: string;
}

export function HBtn({ title, onClick, children }: HBtnProps) {
  return (
    <TextButton data-tip={title} onClick={onClick}>{children}</TextButton>
  );
}

export function InputBtn({ title, onClick, children }: HBtnProps) {
  return <HBtn title={title} onClick={onClick}>{children}</HBtn>;
}

// Shared dropdown and context menu rows.

interface MenuItemProps {
  role?: 'menuitem';
  label: string;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  danger?: boolean;
  disabled?: boolean;
  /** Shortcut badge displayed at the end of the row. */
  shortcut?: string;
  /** Radio/switch state; renders a trailing mark and exposes menuitemradio semantics. */
  checked?: boolean;
  submenu?: boolean;
  expanded?: boolean;
  controls?: string;
  onPointerEnter?: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void;
}

export function MenuItem({ label, onClick, danger, shortcut, role, disabled, checked, submenu, expanded, controls, onPointerEnter, onKeyDown }: MenuItemProps) {
  const style: CSSProperties = { ...menuItemStyle, display: 'flex', alignItems: 'center', gap: 16 };
  return (
    <button
      onClick={onClick}
      onPointerEnter={onPointerEnter}
      onKeyDown={onKeyDown}
      disabled={disabled}
      role={checked !== undefined ? 'menuitemradio' : role}
      aria-checked={checked !== undefined ? checked : undefined}
      aria-haspopup={submenu ? 'menu' : undefined}
      aria-expanded={submenu ? expanded : undefined}
      aria-controls={expanded ? controls : undefined}
      data-submenu-open={expanded || undefined}
      data-subtle
      className="workspace-floating-row"
      style={danger ? { ...style, color: 'var(--control-danger-color)' } : style}
    >
      <span data-menu-label style={{ flex: 1, minWidth: 0 }}>{label}</span>
      {shortcut && <KeyHint shortcut={shortcut} />}
      {checked === true && <span aria-hidden="true" data-check-slot style={checkSlotStyle}><Check size={12} /></span>}
      {submenu && <ChevronRight size={14} aria-hidden="true" style={{ flexShrink: 0 }} />}
    </button>
  );
}

const menuItemStyle: CSSProperties = {
  display: 'block', width: '100%', textAlign: 'left' as const,
  padding: '6px 12px', border: 'none',
  color: 'var(--text-primary)', cursor: 'pointer', fontSize: 'calc(12px * var(--ui-font-scale))',
};

/** Selection marks trail the label without reserving a leading column. */
const checkSlotStyle: CSSProperties = {
  width: 12, display: 'inline-flex', justifyContent: 'center',
  color: 'var(--accent)', flexShrink: 0,
};

// Shared sidebar icon controls keep a comfortable pointer target.

interface IconBtnProps {
  title: string;
  onClick?: (e: MouseEvent) => void;
  disabled?: boolean;
  children: React.ReactNode;
  [key: string]: unknown;
}

export function IconBtn({ title, onClick, disabled, children, ...rest }: IconBtnProps) {
  return <IconButton data-subtle data-tip={title} aria-label={title} onClick={onClick}
    disabled={disabled} {...rest}>{children}</IconButton>;
}

// Toolbar controls use the same pointer target as sidebar controls.

interface ToolbarBtnProps {
  title: string;
  active?: boolean;
  onClick?: (e: MouseEvent) => void;
  children: React.ReactNode;
  /** 附加的 HTML 属性（如 data-*, draggable, onDragStart 等） */
  attrs?: Record<string, unknown>;
}

export function ToolbarBtn({ title, active, onClick, children, attrs }: ToolbarBtnProps) {
  const { className, ...attributes } = attrs ?? {};
  return <IconButton data-subtle className={`toolbar-icon-button ${typeof className === 'string' ? className : ''}`} data-active={active}
    data-tip={title} aria-label={title} onClick={onClick} {...attributes}>{children}</IconButton>;
}

// ── 时长/大小格式化 ──

export function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}m${s}s`;
}

/** 字节数格式化（B/KB/MB/GB/TB）。 */
export function fmtSize(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}
