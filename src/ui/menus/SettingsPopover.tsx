import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useFloatingPanelPosition } from '../hooks/useFloatingPanelPosition';
import { hasOwnedListbox } from '../hooks/useExclusiveMenu';
import type { MenuAnchor } from './ContextMenu';

export default function SettingsPopover({ anchor, label, onClose, suspended = false, children }: {
  anchor: MenuAnchor; label: string; onClose: () => void; suspended?: boolean; children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const position = useFloatingPanelPosition(panel, anchor);
  const close = useRef(onClose); close.current = onClose;
  useLayoutEffect(() => { panel.current?.querySelector<HTMLElement>('input:not(:disabled), button:not(:disabled)')?.focus(); }, []);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (suspended || panel.current?.contains(event.target as Node) || anchor.trigger?.contains(event.target as Node)) return;
      if (hasOwnedListbox(panel.current)) return;
      close.current();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || suspended || hasOwnedListbox(panel.current)) return;
      event.preventDefault(); event.stopPropagation(); anchor.trigger?.focus(); close.current();
    };
    document.addEventListener('pointerdown', dismiss, true); window.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', dismiss, true); window.removeEventListener('keydown', escape); };
  }, [anchor.trigger, suspended]);
  return createPortal(<div ref={panel} role="dialog" aria-modal="false" aria-label={label} className="workspace-floating settings-popover"
    style={{ position: 'fixed', ...position, zIndex: 9995, width: 'max-content', maxWidth: 'calc(100vw - 16px)', maxHeight: 'calc(100vh - 16px)', overflowY: 'auto', boxSizing: 'border-box', padding: 8 }}>
    {children}
  </div>, document.body);
}
