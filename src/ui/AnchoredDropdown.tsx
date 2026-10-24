import { useLayoutEffect, useState, type ComponentPropsWithoutRef, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useFloatingPanelPosition } from './hooks/useFloatingPanelPosition';

export default function AnchoredDropdown({ open, onClose, panelRef, above = false, children, className = '', onKeyDown, ...props }: ComponentPropsWithoutRef<'div'> & {
  open: boolean; onClose: () => void; panelRef: RefObject<HTMLDivElement | null>; above?: boolean;
}) {
  const [anchor, setAnchor] = useState<{ x: number; y: number; above?: HTMLElement }>({ x: 8, y: 48 });
  const position = useFloatingPanelPosition(panelRef, anchor, undefined, open);
  useLayoutEffect(() => {
    if (!open) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const bounds = trigger?.getBoundingClientRect();
    setAnchor(bounds?.width ? { x: bounds.left, y: bounds.bottom + 4, above: above ? trigger ?? undefined : undefined } : { x: 8, y: 48 });
    return () => { if (trigger?.isConnected) trigger.focus(); };
  }, [open, above]);
  if (!open) return null;
  return createPortal(<div className="new-tab-overlay new-tab-dropdown-overlay" onClick={onClose}>
    <div {...props} ref={panelRef} tabIndex={-1} className={`workspace-floating new-tab-dialog ${className}`} role="dialog" aria-modal="false"
      style={{ position: 'fixed', ...position }} onClick={event => event.stopPropagation()} onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return; }
        onKeyDown?.(event);
      }}>{children}</div>
  </div>, document.body);
}
