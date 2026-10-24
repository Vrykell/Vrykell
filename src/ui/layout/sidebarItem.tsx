import { Fragment, useId, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import { useListReorder } from '@ui/layout/listReorder';
import { sidebarRowSpacing, sidebarRowContent, sidebarRowIcon, sidebarRowTitle } from '@ui/layout/sidebarRow';
import { IconButton } from '@ui/actions/IconButton';
import { ChevronRight, iconSizes } from '@ui/icons';

export interface SidebarItemAction {
  icon: ReactNode;
  /** Accessible name of the action button. */
  label: string;
  title?: string;
  /** Receives the click event so callers can anchor floating menus on the button. */
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  testId?: string;
  disabled?: boolean;
}

/** Existing shared controls can occupy a trailing action slot. */
type SidebarItemControl = SidebarItemAction | { label: string; control: ReactNode };

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
  tree,
  title,
  titleAccessory,
  subtitle,
  titleFontFamily,
  subtitleFontFamily = 'var(--font-mono)',
  badge,
  action,
  leadingActions,
  trailingActions,
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
  reorderListId,
  dataAttributes,
  style,
  compact = false,
  variant = 'default',
}: {
  icon?: ReactNode;
  tree?: { depth: number; expanded?: boolean; onToggle?: () => void };
  title: string;
  titleAccessory?: ReactNode;
  titleFontFamily?: CSSProperties['fontFamily'];
  subtitle?: string;
  subtitleFontFamily?: CSSProperties['fontFamily'];
  /** Optional trailing content between the title and the action button. */
  badge?: ReactNode;
  action?: SidebarItemAction;
  /** Compact history actions appear beside the row on hover or keyboard focus. */
  leadingActions?: readonly SidebarItemAction[];
  /** Actions inside the row remain reachable in narrow, clipped sidebars. */
  trailingActions?: readonly SidebarItemControl[];
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
  reorderListId?: string;
  /** List-specific data attributes (test hooks such as `data-tab-row-id`). */
  dataAttributes?: Record<string, string | undefined>;
  style?: CSSProperties;
  /** Compact rows reduce padding; history metadata moves into the row description. */
  compact?: boolean;
  /** History records use neutral titles and can show metadata as a compact description. */
  variant?: 'default' | 'history' | 'command' | 'resource';
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const subtitleId = useId();
  const historyCompact = variant === 'history' && compact;
  const command = variant === 'command';
  const resource = variant === 'resource';
  const dragging = useListReorder((state) => !!reorderItemId && state.drag?.id === reorderItemId && (!reorderListId || state.drag.listId === reorderListId));
  const background = active ? 'var(--selection-bg)' : 'var(--sidebar-row-hover, transparent)';
  const actionVisible = hovered || focused || (variant !== 'history' && !resource && active);

  return (
    <div
      {...dataAttributes}
      className={variant === 'history' ? 'sidebar-row history-row' : command ? 'sidebar-row command-row' : resource ? 'sidebar-row resource-row' : 'sidebar-row'}
      data-active={active ? 'true' : 'false'}
      data-actions-visible={command ? actionVisible : undefined}
      {...(variant === 'history' && active ? { 'aria-current': true as const } : {})}
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
      style={{ ...sidebarRowSpacing, ...(compact || command ? { padding: '0 6px' } : {}),
        ...(command ? { '--sidebar-action-width': `${((trailingActions?.length ?? 0) + (action ? 1 : 0)) * 24 + 4}px` } : {}), ...style } as CSSProperties}
    >
      {leadingActions?.length ? <span className="history-row-quick-actions" data-visible={actionVisible}
        onPointerDown={event => event.stopPropagation()}
        onClick={event => event.stopPropagation()}
        onDoubleClick={event => event.stopPropagation()}
        onContextMenu={event => event.stopPropagation()}>
        {leadingActions.map(item => <IconButton key={item.label} compact data-subtle
          aria-label={item.label} data-tip={item.title ?? item.label}
          data-testid={item.testId} disabled={item.disabled} onClick={item.onClick}>
          {item.icon}
        </IconButton>)}
      </span> : null}
      <div className="sidebar-row-content" style={{
        ...sidebarRowContent,
        ...(historyCompact ? { minHeight: 34, padding: '5px 10px', alignItems: 'flex-start' } : compact ? { minHeight: 32, padding: '5px 10px' } : {}),
        ...(command ? { position: 'relative', minHeight: 28, padding: '2px 10px', gap: 6 } : {}),
        ...(tree ? { minHeight: 32, padding: `5px 10px 5px ${4 + tree.depth * 14}px`, gap: 4 } : {}),
        background: variant === 'history' ? undefined : command && focused && !active ? 'var(--hover)' : background,
        color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
      }}>
        {tree && <span data-row-expander style={{ width: iconSizes.compact, flexShrink: 0, display: 'inline-flex', justifyContent: 'center', color: 'var(--text-muted)',
          visibility: tree.expanded === undefined ? 'hidden' : 'visible', transform: tree.expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.12s ease' }}
          onClick={event => { event.stopPropagation(); tree.onToggle?.(); }}><ChevronRight size={iconSizes.compact} /></span>}
        {icon && <span className="sidebar-row-icon" style={{ ...sidebarRowIcon, ...(tree ? { width: 20 } : {}), ...(historyCompact ? { width: 20, height: 'calc(22px * var(--ui-font-scale))' } : {}),
          ...(command ? { width: 14, height: 14 } : {}) }}>{icon}</span>}
        {renameInput ?? (
          <span className="sidebar-row-text" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: resource ? 'row' : 'column', alignItems: resource ? 'center' : undefined, gap: resource ? 6 : 1 }}>
            <span className="sidebar-row-title" data-tip={variant === 'history' ? title : undefined}
              data-tip-description={historyCompact ? subtitle : undefined}
              style={{ ...sidebarRowTitle,
                fontFamily: titleFontFamily ?? (command ? 'var(--font-mono)' : undefined),
                ...(historyCompact ? { display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2, whiteSpace: 'normal', overflowWrap: 'anywhere', fontSize: 'var(--fs-body)', lineHeight: 'calc(22px * var(--ui-font-scale))' } : {}),
                fontWeight: active && !command ? 'var(--fw-semibold)' : 'var(--fw-regular)' }}>{title}{titleAccessory}</span>
            {subtitle && (
              <span className="sidebar-row-subtitle" id={subtitleId}
                data-tip={variant === 'history' ? subtitle : undefined} style={{
                fontSize: 'calc(11px * var(--ui-font-scale))', color: 'var(--text-muted)', lineHeight: '14px',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                fontFamily: subtitleFontFamily,
                ...(historyCompact ? { fontSize: 'var(--fs-caption)', lineHeight: 'calc(16px * var(--ui-font-scale))' } : {}),
              }}>
                {subtitle}
              </span>
            )}
          </span>
        )}
        {!resource && badge}
        {trailingActions?.length ? <span className={command ? 'sidebar-row-inline-actions' : undefined}
          style={{ display: 'inline-flex', alignSelf: 'center', flexShrink: 0,
          ...(command ? { position: 'absolute', right: action ? 30 : 6, top: '50%', transform: 'translateY(-50%)', background: 'transparent' } : { opacity: actionVisible ? 1 : 0 }),
          transition: 'opacity 0.12s ease' }}
          onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}
          onDoubleClick={event => event.stopPropagation()}>
          {trailingActions.map(item => <Fragment key={item.label}>{'control' in item ? item.control : <IconButton compact data-subtle aria-label={item.label}
            data-tip={item.title ?? item.label} disabled={item.disabled} onClick={item.onClick}>{item.icon}</IconButton>}</Fragment>)}
        </span> : null}
        {resource && badge}
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
              width: historyCompact || command ? 24 : 28, height: historyCompact || command ? 24 : 28, padding: 0, border: 'none', borderRadius: 4,
              flexShrink: 0, background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer',
              ...(command ? { position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)' } : {}),
              alignSelf: historyCompact ? 'center' : undefined,
              opacity: command ? undefined : actionVisible ? 1 : 0,
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
