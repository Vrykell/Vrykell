import { useEffect, useLayoutEffect, useState, type ComponentPropsWithoutRef, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useFloatingPanelPosition } from '../hooks/useFloatingPanelPosition';
import { hasOwnedListbox } from '../hooks/useExclusiveMenu';

export interface DropdownAnchor { x: number; y: number; aboveY?: number; align?: 'start' | 'end' }

export default function AnchoredDropdown({ open, onClose, panelRef, above = false, anchor: preferredAnchor, children, className = '', onKeyDown, ...props }: ComponentPropsWithoutRef<'div'> & {
  open: boolean; onClose: () => void; panelRef: RefObject<HTMLDivElement | null>; above?: boolean; anchor?: DropdownAnchor;
}) {
  const [anchor, setAnchor] = useState<DropdownAnchor>({ x: 8, y: 48 });
  const position = useFloatingPanelPosition(panelRef, anchor, undefined, open);
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || hasOwnedListbox(panelRef.current)) return;
      event.preventDefault(); event.stopPropagation(); onClose();
    };
    window.addEventListener('keydown', escape, true);
    return () => window.removeEventListener('keydown', escape, true);
  }, [open, onClose, panelRef]);
  useLayoutEffect(() => {
    if (!open) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const bounds = trigger?.getBoundingClientRect();
    const belowSpace = preferredAnchor ? window.innerHeight - preferredAnchor.y - 8 : bounds ? window.innerHeight - bounds.bottom - 12 : window.innerHeight - 56;
    const aboveSpace = (preferredAnchor?.aboveY ?? bounds?.top ?? 12) - 12;
    const height = Math.min(panelRef.current?.scrollHeight || 480, window.innerHeight - 16);
    const placeAbove = aboveSpace > belowSpace && (above || belowSpace < height);
    setAnchor(preferredAnchor ? { ...preferredAnchor, aboveY: placeAbove ? preferredAnchor.aboveY : undefined } : bounds?.width ? { x: bounds.left, y: bounds.bottom + 4, aboveY: placeAbove ? bounds.top : undefined } : { x: 8, y: 48 });
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
