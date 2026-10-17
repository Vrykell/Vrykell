import { useEffect, useRef, useState, type ReactNode } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { t } from '@i18n';
import { IconButton } from './IconButton';
import { Minus, Pin, PinOff, X, iconSizes } from './icons';
import ErrorBox from './ErrorBox';
import { diagnostic } from '@platform/diagnostics';

/** Native tool chrome minimizes on blur by default; pinning keeps it visible above the workspace. */
export default function ToolWindow({ label, children, footer, onClose, onBeforeClose, initialFocus, busy = false }: {
  label: string; children: ReactNode; footer: ReactNode; onClose: () => void;
  initialFocus?: string; busy?: boolean; onBeforeClose?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(false);
  const pin = useRef(false);
  const [error, setError] = useState('');
  const dragging = useRef(false);
  const lifecycle = useRef({ busy, onBeforeClose }); lifecycle.current = { busy, onBeforeClose };
  useEffect(() => {
    const frame = requestAnimationFrame(() => (initialFocus ? ref.current?.querySelector<HTMLElement>(initialFocus) : ref.current)?.focus());
    let disposed = false; let stop: (() => void) | undefined;
    let blurTimer: ReturnType<typeof setTimeout> | undefined;
    let focusVersion = 0;
    void getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      const version = ++focusVersion;
      clearTimeout(blurTimer);
      diagnostic('tool-window-focus', { focused, pinned: pin.current, dragging: dragging.current });
      if (focused || pin.current || dragging.current) return;
      // Restoring from the taskbar can briefly alternate focus events. Confirm native state after it settles.
      blurTimer = setTimeout(() => {
        const current = getCurrentWindow();
        void Promise.all([current.isFocused(), current.isMinimized()]).then(([active, minimized]) => {
          if (disposed || version !== focusVersion || active || minimized || pin.current || dragging.current) return;
          diagnostic('tool-window-auto-minimize', { windowLabel: current.label });
          return current.minimize();
        }).catch(reason => { if (!disposed) setError(String(reason)); });
      }, 220);
    }).then(unlisten => { if (disposed) unlisten(); else stop = unlisten; }).catch(reason => setError(String(reason)));
    let stopClose: (() => void) | undefined;
    void getCurrentWindow().onCloseRequested(event => {
      if (lifecycle.current.busy) event.preventDefault(); else lifecycle.current.onBeforeClose?.();
    }).then(unlisten => { if (disposed) unlisten(); else stopClose = unlisten; }).catch(reason => setError(String(reason)));
    return () => { disposed = true; focusVersion++; clearTimeout(blurTimer); stop?.(); stopClose?.(); cancelAnimationFrame(frame); };
  }, [initialFocus]);
  const act = (action: Promise<void>) => { void action.catch(reason => setError(String(reason))); };
  return <div ref={ref} tabIndex={-1} role="dialog" aria-modal="false" aria-label={label} data-pinned={pinned}
    className="tool-window" onKeyDown={event => {
      if (event.key !== 'Escape' || event.nativeEvent.isComposing || document.querySelector('[role="listbox"], [role="menu"]')) return;
      event.preventDefault(); event.stopPropagation(); if (!busy) onClose();
    }}>
    <div className="tool-dialog-heading tool-window-heading" data-testid="tool-window-heading" onMouseDown={event => {
      if (event.button !== 0 || dragging.current || event.target instanceof Element && event.target.closest('button')) return;
      event.preventDefault(); event.stopPropagation(); dragging.current = true;
      diagnostic('tool-window-drag', { phase: 'start', width: window.innerWidth, height: window.innerHeight });
      void getCurrentWindow().startDragging().catch(reason => {
        diagnostic('tool-window-drag-error', { windowLabel: getCurrentWindow().label, reason: String(reason) }, 'warn');
        setError(String(reason));
      }).finally(() => { dragging.current = false; diagnostic('tool-window-drag', { phase: 'complete', width: window.innerWidth, height: window.innerHeight }); });
    }}>
      <strong>{label}</strong>
      <div className="tool-window-controls" data-testid="tool-window-controls">
      <IconButton compact tone="neutral" className="tool-window-pin" aria-pressed={pinned} aria-label={t(pinned ? 'Unpin window' : 'Pin window')}
        data-tip={t(pinned ? 'Unpin window' : 'Pin window')} onClick={() => {
          const next = !pinned;
          void getCurrentWindow().setAlwaysOnTop(next).then(() => { pin.current = next; setPinned(next); }).catch(reason => setError(String(reason)));
        }}>{pinned ? <PinOff size={iconSizes.compact} /> : <Pin size={iconSizes.compact} />}</IconButton>
      <IconButton compact aria-label={t('Minimize')} data-tip={t('Minimize')} onClick={() => act(getCurrentWindow().minimize())}><Minus size={iconSizes.compact} /></IconButton>
      <IconButton compact className="tool-window-close" aria-label={t('Close')} data-tip={t('Close')} disabled={busy} onClick={onClose}><X size={iconSizes.compact} /></IconButton>
      </div>
    </div>
    <div className="tool-dialog-body tool-window-body scroll-region">{error && <ErrorBox title={t('Window operation failed')} details={error} />}{children}</div>
    <footer className="tool-window-footer">{footer}</footer>
  </div>;
}
