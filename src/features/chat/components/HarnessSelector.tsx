/**
 * HarnessSelector — one session-level choice in the harness composer (mode, model, or a config
 * option the agent published).
 *
 * The trigger is a quiet chip and the list is the same floating menu the composer's approval chip
 * uses, with the option's description underneath its name: a mode like "YOLO" is only understandable
 * with the sentence that says what it does.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, iconSizes } from '@ui/icons';

export interface HarnessSelectorOption {
  value: string;
  label: string;
  description?: string;
}

export default function HarnessSelector({ label, value, options, onChange, testId }: {
  label: string;
  value: string;
  options: HarnessSelectorOption[];
  onChange: (value: string) => void;
  testId: string;
}) {
  const current = options.find((option) => option.value === value) ?? options[0];
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({});
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const rows = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (!open) return;
    const index = Math.max(0, options.findIndex((option) => option.value === value));
    rows.current[index]?.focus();
    const outside = (event: PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
    // Focus the current row once, when the menu opens: the options array is rebuilt every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(280, window.innerWidth - 24);
      const below = window.innerHeight - rect.bottom > rect.top;
      setPosition({
        position: 'fixed',
        left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
        ...(below ? { top: rect.bottom + 6 } : { bottom: window.innerHeight - rect.top + 6 }),
        width,
        maxHeight: Math.max(80, (below ? window.innerHeight - rect.bottom : rect.top) - 18),
        overflowY: 'auto',
      });
    };
    update();
    window.addEventListener('resize', update);
    document.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      document.removeEventListener('scroll', update, true);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  return (
    <>
      <button ref={trigger} type="button" data-subtle className="harness-selector" data-testid={testId}
        aria-label={label} data-tip={`${label}: ${current?.label ?? ''}`} data-tip-description={current?.description}
        aria-haspopup="listbox" aria-expanded={open}
        onClick={() => setOpen(!open)} onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
          }
        }}>
        <span className="harness-selector-label">{label}:</span>
        <span className="harness-selector-value">{current?.label ?? ''}</span>
        <ChevronDown size={iconSizes.copy} aria-hidden="true" />
      </button>
      {open && createPortal(
        <div ref={menu} role="listbox" aria-label={label} className="workspace-floating"
          style={{ ...position, zIndex: 10000, padding: 4, borderRadius: 10 }}>
          {options.map((option, index) => {
            const selected = option.value === value;
            return (
              <button key={option.value} ref={(element) => { rows.current[index] = element; }}
                type="button" data-subtle role="option" aria-selected={selected}
                className="workspace-floating-row chat-mode-option" data-selected={selected}
                onClick={() => {
                  if (!selected) onChange(option.value);
                  close();
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    close();
                  } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                    event.preventDefault();
                    const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
                      : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
                    rows.current[next]?.focus();
                  }
                }}>
                <span className="chat-approval-option-copy">
                  <span>{option.label}</span>
                  {option.description && <small>{option.description}</small>}
                </span>
                {selected && <Check size={iconSizes.compact} aria-hidden="true" />}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}
