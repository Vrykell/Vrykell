import { useEffect, useLayoutEffect, useState, type ComponentPropsWithoutRef, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useFloatingPanelPosition } from '../hooks/useFloatingPanelPosition';
import { hasOwnedListbox } from '../hooks/useExclusiveMenu';

export interface DropdownAnchor { x: number; y: number; aboveY?: number; align?: 'start' | 'end' }

/** Center a picker that has no trigger, instead of pinning it to the window corner. */
function defaultAnchor(): DropdownAnchor {
  return { x: Math.max(8, (window.innerWidth - 304) / 2), y: Math.max(8, (window.innerHeight - 420) / 2) };
}

export default function AnchoredDropdown({ open, onClose, panelRef, above = false, anchor: preferredAnchor, suspended = false, children, className = '', onKeyDown, ...props }: ComponentPropsWithoutRef<'div'> & {
  open: boolean; onClose: () => void; panelRef: RefObject<HTMLDivElement | null>; above?: boolean; anchor?: DropdownAnchor; suspended?: boolean;
}) {
  const [anchor, setAnchor] = useState<DropdownAnchor>(defaultAnchor);
  const position = useFloatingPanelPosition(panelRef, anchor, undefined, open);
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => {
      if (suspended || event.key !== 'Escape' || event.defaultPrevented || hasOwnedListbox(panelRef.current)) return;
      event.preventDefault(); event.stopPropagation(); onClose();
    };
    window.addEventListener('keydown', escape, true);
    return () => window.removeEventListener('keydown', escape, true);
  }, [open, onClose, panelRef, suspended]);
  useLayoutEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    const trigger = active instanceof HTMLElement && active !== document.body ? active : null;
    const bounds = trigger?.getBoundingClientRect();
    const belowSpace = preferredAnchor ? window.innerHeight - preferredAnchor.y - 8 : bounds ? window.innerHeight - bounds.bottom - 12 : window.innerHeight - 56;
    const anchorTop = preferredAnchor?.aboveY ?? (bounds && bounds.width > 0 ? bounds.top : preferredAnchor ? preferredAnchor.y - 28 : 12);
    const aboveSpace = anchorTop - 12;
    const height = Math.min(panelRef.current?.scrollHeight || 480, window.innerHeight - 16);
    const placeAbove = aboveSpace > belowSpace && (above || belowSpace < height);
    setAnchor(preferredAnchor ? { ...preferredAnchor, aboveY: placeAbove ? anchorTop : undefined } : bounds?.width ? { x: bounds.left, y: bounds.bottom + 4, aboveY: placeAbove ? bounds.top : undefined } : defaultAnchor());
    return () => { if (trigger?.isConnected) trigger.focus(); };
  }, [open, above, panelRef, preferredAnchor]);
  if (!open) return null;
  return createPortal(<div className="new-tab-overlay new-tab-dropdown-overlay" onClick={onClose}>
    <div {...props} ref={panelRef} tabIndex={-1} className={`workspace-floating new-tab-dialog ${className}`} role="dialog" aria-modal="false"
      style={{ position: 'fixed', ...position }} onClick={event => event.stopPropagation()} onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return; }
        onKeyDown?.(event);
      }}>{children}</div>
  </div>, document.body);
}
