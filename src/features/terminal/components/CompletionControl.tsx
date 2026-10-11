import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { t } from '@i18n';
import CheckboxMenu from '@ui/CheckboxMenu';
import KeyHint from '@ui/KeyHint';
import { ChevronDown } from '@ui/icons';
import { COMPLETION_SHORTCUTS, completionShortcut, useCompletionPreferences, validCustomCompletionShortcut } from '@config/completion';

/** A small inline shortcut indicator opens an acceptance-key picker above the input. */
export default function CompletionControl({ onReturnFocus }: { onReturnFocus: () => void }) {
  const { shortcuts, customShortcut, toggle, setCustom } = useCompletionPreferences();
  const [open, setOpen] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const close = useCallback(() => {
    setOpen(false); setCapturing(false);
    if (panel.current?.contains(document.activeElement) || document.activeElement === trigger.current || document.activeElement === document.body) onReturnFocus();
  }, [onReturnFocus]);

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const height = panel.current?.getBoundingClientRect().height ?? 154;
      const top = rect.top - height - 6;
      setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - 188)), top: Math.max(8, top >= 8 ? top : Math.min(rect.bottom + 6, window.innerHeight - height - 8)) });
    };
    update();
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update);
    if (panel.current) observer?.observe(panel.current);
    window.addEventListener('resize', update);
    document.addEventListener('scroll', update, true);
    return () => { observer?.disconnect(); window.removeEventListener('resize', update); document.removeEventListener('scroll', update, true); };
  }, [open]);

  const names = { ArrowRight: t('Right arrow'), Tab: 'Tab', 'Shift+ArrowRight': t('Shift + right arrow') };
  const options = COMPLETION_SHORTCUTS.map(id => ({ id: id as string, label: names[id], displayLabel: id === 'Tab' ? <span>Tab</span> : <KeyHint shortcut={id} />, checked: shortcuts.includes(id) }));
  if (customShortcut) options.push({ id: customShortcut, label: customShortcut, displayLabel: <KeyHint shortcut={customShortcut} />, checked: shortcuts.includes(customShortcut) });

  return <>
    <button ref={trigger} type="button" data-subtle className="command-completion-trigger terminal-chip"
      aria-label={t('Completion shortcuts')} aria-haspopup="menu" aria-expanded={open}
      onClick={() => open ? close() : setOpen(true)}>
      <KeyHint shortcut={shortcuts[0] ?? 'ArrowRight'} /><ChevronDown size={10} aria-hidden="true" />
    </button>
    {open && createPortal(<div ref={panel} style={{ position: 'fixed', ...position, width: 180, zIndex: 200 }}>
      <CheckboxMenu compact triggerRef={trigger} title={t('Completion shortcuts')} options={options} onToggle={toggle} onClose={close}
        style={{ position: 'relative', minWidth: 0, width: '100%' }} footer={
          <button type="button" data-subtle className="completion-shortcut-custom"
            onClick={event => { event.currentTarget.focus(); setCapturing(true); }} onKeyDown={event => {
              if (!capturing) return;
              event.preventDefault(); event.stopPropagation();
              if (event.key === 'Escape') { setCapturing(false); return; }
              const shortcut = completionShortcut(event);
              if (validCustomCompletionShortcut(shortcut)) { setCustom(shortcut); setCapturing(false); }
            }}>
            {capturing ? t('Press a modified letter or number…') : t('Custom…')}
          </button>
        } />
    </div>, document.body)}
  </>;
}
