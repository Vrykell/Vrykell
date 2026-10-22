import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { iconSizes, Check, ChevronDown, Plus } from '@ui/icons';
import './Select.css';

export interface SelectOption<Value extends string | number> {
  value: Value;
  label: string;
  /** Optional concise label for the trigger; the list retains the full option label. */
  triggerLabel?: string;
  disabled?: boolean;
  /** Optional mark rendered before the label (the list and the trigger share it). */
  icon?: ReactNode;
  /** Optional colour swatch rendered before the label. */
  swatch?: string;
  /** Optional trailing status node (the list and the trigger share it). */
  badge?: ReactNode;
}

/** Trailing action pinned below the options (e.g. "New tab"); the arrow keys reach it. */
interface SelectAction {
  label: string;
  onSelect: () => void;
}

interface SelectProps<Value extends string | number> {
  value: Value;
  options: readonly SelectOption<Value>[];
  onChange: (value: Value) => void;
  'aria-label': string;
  'aria-describedby'?: string;
  'data-testid'?: string;
  'data-tip'?: string;
  'data-tip-description'?: string;
  id?: string;
  disabled?: boolean;
  placeholder?: string;
  style?: CSSProperties;
  /** Extra class on the trigger, for a surface that is not a plain form control. */
  triggerClassName?: string;
  action?: SelectAction;
}

/** A controlled select with a themed, viewport-aware listbox. */
export default function Select<Value extends string | number>({
  value, options, onChange, disabled = false, placeholder = '请选择', style, id, action, triggerClassName,
  'aria-label': label, 'aria-describedby': description, 'data-testid': testId,
  'data-tip': tip, 'data-tip-description': tipDescription,
}: SelectProps<Value>) {
  const listId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const search = useRef({ text: '', time: 0 });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [position, setPosition] = useState<CSSProperties>({});
  const [placement, setPlacement] = useState('bottom');
  const selected = options.findIndex(option => option.value === value);
  const enabled = options.map((option, index) => option.disabled ? -1 : index).filter(index => index >= 0);
  const unavailable = disabled || enabled.length === 0;
  const expanded = open && !unavailable;
  const actionIndex = action ? options.length : -1;
  const navigable = actionIndex >= 0 ? [...enabled, actionIndex] : enabled;
  const activeIndex = navigable.includes(active) ? active : enabled[0] ?? actionIndex;

  const show = (last = false) => {
    if (unavailable) return;
    search.current = { text: '', time: 0 };
    setActive(enabled.includes(selected) ? selected : last ? enabled[enabled.length - 1] : enabled[0]);
    setOpen(true);
  };
  const choose = (index: number) => {
    if (action && index === actionIndex) {
      setOpen(false);
      trigger.current?.focus();
      action.onSelect();
      return;
    }
    const option = options[index];
    if (!option || option.disabled) return;
    setOpen(false);
    trigger.current?.focus();
    if (option.value !== value) onChange(option.value);
  };

  useEffect(() => { if (unavailable) setOpen(false); }, [unavailable]);
  useLayoutEffect(() => {
    if (!expanded) return;
    const update = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const gutter = 8;
      const gap = 6;
      const below = Math.max(0, window.innerHeight - rect.bottom - gap - gutter);
      const above = Math.max(0, rect.top - gap - gutter);
      const height = Math.min(240, menu.current?.scrollHeight || options.length * 32 + 10);
      const flip = below < height && above > below;
      const maxHeight = Math.min(240, flip ? above : below);
      const width = Math.min(Math.max(rect.width, 160), window.innerWidth - gutter * 2);
      setPlacement(flip ? 'top' : 'bottom');
      setPosition({
        left: Math.max(gutter, Math.min(rect.left, window.innerWidth - width - gutter)),
        top: flip ? rect.top - gap : rect.bottom + gap,
        width, maxHeight, transform: flip ? 'translateY(-100%)' : undefined,
      });
    };
    update();
    const onScroll = (event: Event) => {
      if (!menu.current?.contains(event.target as Node)) update();
    };
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!trigger.current?.contains(target) && !menu.current?.contains(target)) setOpen(false);
    };
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update);
    if (trigger.current) observer?.observe(trigger.current);
    window.addEventListener('resize', update);
    document.addEventListener('scroll', onScroll, true);
    document.addEventListener('pointerdown', outside);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
      document.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('pointerdown', outside);
    };
  }, [expanded, options.length]);

  useLayoutEffect(() => {
    if (expanded) document.getElementById(`${listId}-${activeIndex}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [expanded, activeIndex, listId]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (unavailable) return;
    const { key } = event;
    if (key === 'Escape' && expanded) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    } else if (key === 'Tab') {
      setOpen(false);
    } else if (key === 'Enter' || key === ' ') {
      event.preventDefault();
      if (expanded) choose(activeIndex);
      else show();
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(key)) {
      event.preventDefault();
      if (!expanded) show(key === 'ArrowUp' || key === 'End');
      if (key === 'Home') setActive(enabled[0]);
      else if (key === 'End') setActive(enabled[enabled.length - 1]);
      else if (expanded) {
        const current = navigable.indexOf(activeIndex);
        setActive(navigable[(current + (key === 'ArrowDown' ? 1 : -1) + navigable.length) % navigable.length]);
      }
    } else if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      if (!expanded) show();
      const now = Date.now();
      const text = (now - search.current.time < 700 ? search.current.text : '') + key.toLocaleLowerCase();
      search.current = { text, time: now };
      const start = expanded ? activeIndex : selected;
      const matches = [...enabled.filter(index => index > start), ...enabled.filter(index => index <= start)];
      const next = matches.find(index => options[index].label.toLocaleLowerCase().startsWith(text));
      if (next !== undefined) setActive(next);
    }
  };

  return <>
    <button ref={trigger} id={id} type="button" data-subtle data-testid={testId} data-tip={tip} data-tip-description={tipDescription} className={triggerClassName ? `ui-select ${triggerClassName}` : 'ui-select'} style={style}
      role="combobox" aria-label={label} aria-describedby={description} aria-haspopup="listbox"
      aria-expanded={expanded} aria-controls={expanded ? listId : undefined}
      aria-activedescendant={expanded ? `${listId}-${activeIndex}` : undefined} disabled={unavailable}
      onClick={() => expanded ? setOpen(false) : show()} onKeyDown={onKeyDown} onBlur={() => setOpen(false)}>
      {options[selected]?.icon && <span className="ui-select-icon" aria-hidden="true">{options[selected]!.icon}</span>}
      {options[selected]?.swatch && <span className="ui-select-swatch" aria-hidden="true"
        style={{ background: options[selected]!.swatch }} />}
      <span className="ui-select-value">{options[selected]?.triggerLabel ?? options[selected]?.label ?? placeholder}</span>
      {options[selected]?.badge && <span className="ui-select-badge">{options[selected]!.badge}</span>}
      <ChevronDown size={iconSizes.compact} aria-hidden="true" className="ui-select-chevron" />
    </button>
    {expanded && createPortal(<div ref={menu}
      className="workspace-floating ui-select-menu" style={position} data-placement={placement} data-floating-for={listId}
      onPointerDown={event => event.preventDefault()}>
      <div id={listId} role="listbox" aria-label={label} className="ui-select-options">
        {options.map((option, index) => <div key={option.value} id={`${listId}-${index}`} role="option"
          aria-selected={index === selected} aria-disabled={option.disabled || undefined}
          className="ui-select-option" data-active={index === activeIndex}
          onPointerMove={() => { if (!option.disabled) setActive(index); }} onClick={() => choose(index)}>
          {option.icon && <span className="ui-select-icon" aria-hidden="true">{option.icon}</span>}
          {option.swatch && <span className="ui-select-swatch" aria-hidden="true" style={{ background: option.swatch }} />}
          <span className="ui-select-option-label">{option.label}</span>
          {option.badge && <span className="ui-select-badge">{option.badge}</span>}
          {index === selected && <Check size={iconSizes.compact} aria-hidden="true" className="ui-select-check" />}
        </div>)}
      </div>
      {action && <button type="button" id={`${listId}-${actionIndex}`} className="ui-select-action"
        data-active={activeIndex === actionIndex}
        onPointerMove={() => setActive(actionIndex)}
        onClick={() => choose(actionIndex)}>
        <Plus size={iconSizes.compact} aria-hidden="true" />
        <span>{action.label}</span>
      </button>}
    </div>, document.body)}
  </>;
}
