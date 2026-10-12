import { useEffect, useRef, type RefObject } from 'react';

interface Options {
  onClose: () => void;
  onSubmit?: () => void;
  initialFocus?: string;
  disabled?: boolean;
}

/** Keep keyboard navigation within the active dialog and restore its trigger on dismissal. */
export function useDialogKeyboard(ref: RefObject<HTMLElement | null>, open: boolean, options: Options) {
  const current = useRef(options);
  current.current = options;
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () => Array.from(ref.current?.querySelectorAll<HTMLElement>('input:not(:disabled), textarea:not(:disabled), button:not(:disabled), [tabindex="0"]') ?? [])
      .filter(element => element.tabIndex >= 0 && !element.closest('[hidden]'));
    const timer = requestAnimationFrame(() => {
      const initial = current.current.initialFocus ? ref.current?.querySelector<HTMLElement>(current.current.initialFocus) : null;
      (initial ?? focusable()[0] ?? ref.current)?.focus();
    });
    const key = (event: KeyboardEvent) => {
      const dialogs = document.querySelectorAll('[role="dialog"]');
      if (dialogs[dialogs.length - 1] !== ref.current) return;
      if (document.querySelector('[role="listbox"], [role="menu"]')) return;
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation();
        if (!current.current.disabled) current.current.onClose();
      } else if (event.key === 'Tab') {
        const fields = focusable();
        const first = fields[0]; const last = fields[fields.length - 1];
        if (!first || !last) { event.preventDefault(); return; }
        if (!ref.current?.contains(document.activeElement) || (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
          event.preventDefault(); (event.shiftKey ? last : first).focus();
        }
      } else if (event.key === 'Enter' && !event.isComposing && current.current.onSubmit) {
        const target = event.target;
        const singleInput = target instanceof HTMLInputElement && !['checkbox', 'button'].includes(target.type);
        if (singleInput || event.ctrlKey || event.metaKey) {
          event.preventDefault(); event.stopPropagation();
          if (!current.current.disabled) current.current.onSubmit();
        }
      }
    };
    document.addEventListener('keydown', key, true);
    return () => {
      cancelAnimationFrame(timer);
      document.removeEventListener('keydown', key, true);
      if (previous?.isConnected) previous.focus();
    };
  }, [open, ref]);
}
