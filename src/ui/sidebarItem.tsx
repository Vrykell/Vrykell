import { useId, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import { useListReorder } from './listReorder';
import { sidebarRowSpacing, sidebarRowContent, sidebarRowIcon, sidebarRowTitle } from './sidebarRow';

export interface SidebarItemAction {
  icon: ReactNode;
  /** Accessible name of the trailing action button. */
  label: string;
  title?: string;
  /** Receives the click event so callers can anchor floating menus on the button. */
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  testId?: string;
  disabled?: boolean;
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
  subtitleFontFamily = 'var(--font-mono)',
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
  variant = 'default',
}: {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  subtitleFontFamily?: CSSProperties['fontFamily'];
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
  /** Compact rows reduce padding; history metadata moves into the row description. */
  compact?: boolean;
  /** History records use neutral titles and can show metadata as a compact description. */
  variant?: 'default' | 'history';
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const subtitleId = useId();
  const historyCompact = variant === 'history' && compact;
  const dragging = useListReorder((state) => !!reorderItemId && state.drag?.id === reorderItemId);
  const background = active ? 'var(--selection-bg)' : hovered ? 'var(--hover)' : 'transparent';
  const actionVisible = hovered || focused || (variant !== 'history' && active);

  return (
    <div
      {...dataAttributes}
      className={variant === 'history' ? 'sidebar-row history-row' : 'sidebar-row'}
      data-active={active ? 'true' : 'false'}
      aria-current={variant === 'history' && active ? 'true' : undefined}
      data-compact={historyCompact ? 'true' : undefined}
      aria-describedby={historyCompact && subtitle ? subtitleId : undefined}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={event => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
      tabIndex={tabIndex}
      data-tip={historyCompact ? title : tooltip}
      data-tip-description={historyCompact ? subtitle : undefined}
      data-testid={testId}
      data-reorder-item={reorderItemId}
      data-reorder-kind={reorderKind}
      data-reorder-dragging={dragging ? 'true' : undefined}
      style={{ ...sidebarRowSpacing, ...(compact ? { padding: '0 6px' } : {}), ...style }}
    >
      <div className="sidebar-row-content" style={{
        ...sidebarRowContent,
        ...(historyCompact ? { minHeight: 34, padding: '5px 10px', alignItems: 'flex-start' } : compact ? { minHeight: 32, padding: '5px 10px' } : {}),
        background: variant === 'history' ? undefined : background,
        color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
      }}>
        <span className="sidebar-row-icon" style={{ ...sidebarRowIcon, ...(historyCompact ? { width: 20, height: 'calc(22px * var(--ui-font-scale))' } : {}) }}>{icon}</span>
        {renameInput ?? (
          <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span className="sidebar-row-title" data-tip={variant === 'history' ? title : undefined}
              data-tip-description={historyCompact ? subtitle : undefined}
              style={{ ...sidebarRowTitle,
                ...(historyCompact ? { display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2, whiteSpace: 'normal', overflowWrap: 'anywhere', fontSize: 'var(--fs-body)', lineHeight: 'calc(22px * var(--ui-font-scale))' } : {}),
                fontWeight: active ? 'var(--fw-semibold)' : 'var(--fw-regular)' }}>{title}</span>
            {subtitle && (
              <span className="sidebar-row-subtitle" id={subtitleId} hidden={historyCompact}
                data-tip={variant === 'history' ? subtitle : undefined} style={{
                fontSize: 'calc(11px * var(--ui-font-scale))', color: 'var(--text-muted)', lineHeight: '14px',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                fontFamily: subtitleFontFamily,
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
            disabled={action.disabled}
            data-tip={action.title ?? action.label}
            data-testid={action.testId}
            onDoubleClick={(event) => event.stopPropagation()}
            onClick={(event) => { event.stopPropagation(); action.onClick(event); }}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: historyCompact ? 24 : 28, height: historyCompact ? 24 : 28, padding: 0, border: 'none', borderRadius: 4,
              flexShrink: 0, background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer',
              alignSelf: historyCompact ? 'center' : undefined,
              opacity: actionVisible ? 1 : 0,
              pointerEvents: variant === 'history' && !actionVisible ? 'none' : undefined,
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
