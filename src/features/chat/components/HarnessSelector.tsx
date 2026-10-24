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
import { useListNavigationMode } from '@ui/hooks/useListNavigationMode';
import { TextInput } from '@ui/fields/TextInput';
import { t } from '@i18n';
import { modelMark } from '@features/agent/components/modelIcon';

export interface HarnessSelectorOption {
  value: string;
  label: string;
  description?: string;
}

export default function HarnessSelector({ label, value, options, onChange, testId, model = false }: {
  label: string;
  value: string;
  options: HarnessSelectorOption[];
  onChange: (value: string) => void;
  testId: string;
  model?: boolean;
}) {
  const current = options.find((option) => option.value === value) ?? options[0];
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({});
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const rows = useRef<Array<HTMLButtonElement | null>>([]);
  const navigation = useListNavigationMode(true);
  const [query, setQuery] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const filtered = options.filter(option => !query || `${option.label} ${option.description ?? ''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));

  useEffect(() => {
    if (!open) return;
    setQuery('');
    const index = Math.max(0, options.findIndex((option) => option.value === value));
    if (options.length > 8) input.current?.focus();
    else rows.current[index]?.focus();
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
      const width = Math.min(360, window.innerWidth - 24);
      const below = window.innerHeight - rect.bottom > rect.top;
      setPosition({
        position: 'fixed',
        left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
        ...(below ? { top: rect.bottom + 6 } : { bottom: window.innerHeight - rect.top + 6 }),
        width,
        maxHeight: Math.min(380, Math.max(80, (below ? window.innerHeight - rect.bottom : rect.top) - 18)),
        overflow: 'hidden',
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

  useLayoutEffect(() => {
    if (open && position.maxHeight) rows.current[Math.max(0, options.findIndex(option => option.value === value))]?.scrollIntoView?.({ block: 'nearest' });
  }, [open, position.maxHeight]);

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  return (
    <>
      <button ref={trigger} type="button" data-subtle className="harness-selector" data-testid={testId}
        aria-label={label} data-tip={`${label}: ${current?.label ?? ''}`} data-tip-description={current?.description}
        aria-haspopup="listbox" aria-expanded={open}
        onClick={event => { navigation.setKeyboardNavigation(event.detail === 0); setOpen(!open); }} onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            navigation.setKeyboardNavigation(true);
            setOpen(true);
          }
        }}>
        <span className="harness-selector-label">{label}:</span>
        <span className="harness-selector-value">{current?.label ?? ''}</span>
        <ChevronDown size={iconSizes.copy} aria-hidden="true" />
      </button>
      {open && createPortal(
        <div {...navigation.props} ref={menu} className="workspace-floating harness-select-menu"
          style={{ ...position, zIndex: 10000, padding: 4, borderRadius: 10 }}>
          {options.length > 8 && <TextInput ref={input} className="harness-select-search" value={query} aria-label={t('Search options…')} placeholder={t('Search options…')} onChange={event => setQuery(event.target.value)} onKeyDown={event => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
            if (event.key === 'ArrowDown') { event.preventDefault(); navigation.setKeyboardNavigation(true); rows.current[0]?.focus(); }
          }} />}
          <div className="harness-select-options" role="listbox" aria-label={label} data-list-navigation="true" data-keyboard-navigation={navigation.keyboardNavigation}>
          {filtered.map((option, index) => {
            const selected = option.value === value;
            const Mark = model ? modelMark('openai-compatible', option.value) : null;
            return (
              <button key={option.value} ref={(element) => { rows.current[index] = element; }}
                type="button" data-subtle role="option" aria-selected={selected}
                className="workspace-floating-row harness-select-option"
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
                    navigation.setKeyboardNavigation(true);
                    const next = event.key === 'Home' ? 0 : event.key === 'End' ? filtered.length - 1
                      : (index + (event.key === 'ArrowDown' ? 1 : -1) + filtered.length) % filtered.length;
                    rows.current[next]?.focus();
                  }
                }}>
                {Mark && <Mark size={iconSizes.row} aria-hidden="true" />}
                <span className="chat-approval-option-copy">
                  <span>{option.label}</span>
                  {option.description && <small>{option.description}</small>}
                </span>
                {selected && <Check size={iconSizes.compact} aria-hidden="true" />}
              </button>
            );
          })}
          {!filtered.length && <div className="ai-launch-empty">{t('No matching options')}</div>}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
