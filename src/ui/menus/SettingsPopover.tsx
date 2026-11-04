import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useFloatingPanelPosition } from '../hooks/useFloatingPanelPosition';
import { hasOwnedListbox } from '../hooks/useExclusiveMenu';
import type { MenuAnchor } from './ContextMenu';
import { t } from '@i18n';
import { IconButton } from '@ui/actions/IconButton';
import { X } from '@ui/icons';

export default function SettingsPopover({ anchor, label, onClose, suspended = false, children }: {
  anchor: MenuAnchor; label: string; onClose: () => void; suspended?: boolean; children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const position = useFloatingPanelPosition(panel, anchor);
  const close = useRef(onClose); close.current = onClose;
  useLayoutEffect(() => { (content.current?.querySelector<HTMLElement>('input:not(:disabled), button:not(:disabled)') ?? panel.current?.querySelector<HTMLElement>('button:not(:disabled)'))?.focus(); }, []);
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
    <div className="settings-popover-heading"><span>{label}</span><IconButton compact disabled={suspended} aria-label={t('Close menu')} data-tip={t('Close menu')} onClick={() => { anchor.trigger?.focus(); close.current(); }}><X size={16} /></IconButton></div>
    <div ref={content} className="settings-popover-content">{children}</div>
  </div>, document.body);
}
