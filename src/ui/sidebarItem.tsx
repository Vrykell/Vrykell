import { useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import { useListReorder } from './listReorder';
import { sidebarRowSpacing, sidebarRowContent, sidebarRowIcon, sidebarRowTitle } from './sidebarRow';

export interface SidebarItemAction {
  icon: ReactNode;
  /** Accessible name of the trailing action button. */
  label: string;
  title?: string;
  onClick: () => void;
  testId?: string;
}

/**
 * SidebarItem — one row of a sidebar list (session tabs, SSH connections).
 *
 * Owns the shared row geometry, hover/selection background and the trailing
 * action button, so every list that looks like this keeps one implementation.
 * Rows that participate in reordering pass `reorderItemId`/`reorderKind` and
 * an `onPointerDown` handler built with `useListReorderDrag`.
 */
export default function SidebarItem({
  icon,
  title,
  subtitle,
  badge,
  action,
  renameInput,
  active,
  onClick,
  onDoubleClick,
  onContextMenu,
  onKeyDown,
  onPointerDown,
  tabIndex,
  tooltip,
  testId,
  reorderItemId,
  reorderKind,
  dataAttributes,
  style,
  compact = false,
}: {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  /** Optional trailing content between the title and the action button. */
  badge?: ReactNode;
  action?: SidebarItemAction;
  /** Replaces the title area while an inline rename is active. */
  renameInput?: ReactNode;
  active: boolean;
  onClick?: () => void;
  onDoubleClick?: () => void;
  onContextMenu?: (event: MouseEvent<HTMLElement>) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
  onPointerDown?: (event: PointerEvent<HTMLElement>) => void;
  tabIndex?: number;
  tooltip?: string;
  testId?: string;
  /** Stable id consumed by the shared list-reorder hook. */
  reorderItemId?: string;
  reorderKind?: string;
  /** List-specific data attributes (test hooks such as `data-tab-row-id`). */
  dataAttributes?: Record<string, string | undefined>;
  style?: CSSProperties;
  /** Compact single-line rows use the same 32px height as file lists. */
  compact?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const dragging = useListReorder((state) => !!reorderItemId && state.drag?.id === reorderItemId);
  const background = active ? 'var(--selection-bg)' : hovered ? 'var(--hover)' : 'transparent';
  const actionVisible = active || hovered;

  return (
    <div
      {...dataAttributes}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      tabIndex={tabIndex}
      data-tip={tooltip}
      data-testid={testId}
      data-reorder-item={reorderItemId}
      data-reorder-kind={reorderKind}
      data-reorder-dragging={dragging ? 'true' : undefined}
      style={{ ...sidebarRowSpacing, ...(compact ? { padding: '0 6px' } : {}), ...style }}
    >
      <div style={{
        ...sidebarRowContent,
        ...(compact ? { minHeight: 32, padding: '5px 10px' } : {}),
        background,
        color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
      }}>
        <span style={sidebarRowIcon}>{icon}</span>
        {renameInput ?? (
          <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span style={{ ...sidebarRowTitle, fontWeight: active ? 'var(--fw-semibold)' : 'var(--fw-regular)' }}>{title}</span>
            {subtitle && (
              <span style={{
                fontSize: 'calc(11px * var(--ui-font-scale))', color: 'var(--text-muted)', lineHeight: '14px',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                fontFamily: 'var(--font-mono)',
              }}>
                {subtitle}
              </span>
            )}
          </span>
        )}
        {badge}
        {action && (
          <button
            type="button"
            data-subtle
            data-no-drag
            className="sidebar-row-action"
            aria-label={action.label}
            data-tip={action.title ?? action.label}
            data-testid={action.testId}
            onDoubleClick={(event) => event.stopPropagation()}
            onClick={(event) => { event.stopPropagation(); action.onClick(); }}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 28, height: 28, padding: 0, border: 'none', borderRadius: 4,
              flexShrink: 0, background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer',
              opacity: actionVisible ? 1 : 0,
              transition: 'opacity 0.12s ease',
            }}
            onMouseEnter={(event) => {
              event.currentTarget.style.background = 'var(--button-hover)';
              event.currentTarget.style.color = 'var(--text-primary)';
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.background = 'transparent';
              event.currentTarget.style.color = 'var(--text-muted)';
            }}
          >
            {action.icon}
          </button>
        )}
      </div>
    </div>
  );
}
