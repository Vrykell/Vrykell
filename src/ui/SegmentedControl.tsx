import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import './SegmentedControl.css';

export default function SegmentedControl<Value extends string>({ label, value, options, onChange, variant = 'radio' }: {
  label: string; value: Value; options: readonly { value: Value; label: string; ariaLabel?: string; icon?: ReactNode }[]; onChange: (value: Value) => void; variant?: 'radio' | 'buttons';
}) {
  const container = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState({ left: 3, width: 0 });
  useLayoutEffect(() => {
    const root = container.current;
    if (!root) return;
    const update = () => {
      const index = options.findIndex(option => option.value === value);
      const button = root.querySelectorAll<HTMLButtonElement>('button')[index];
      if (button) setSelection(previous => previous.left === button.offsetLeft && previous.width === button.offsetWidth ? previous : { left: button.offsetLeft, width: button.offsetWidth });
    };
    update();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update);
    observer?.observe(root);
    return () => observer?.disconnect();
  }, [value, options]);
  return <div ref={container} className="segmented-control" role={variant === 'radio' ? 'radiogroup' : 'group'} aria-label={label} onKeyDown={event => {
    if (!options.length || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const current = options.findIndex(option => option.value === value);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (current + (event.key === 'ArrowLeft' ? -1 : 1) + options.length) % options.length;
    onChange(options[next].value);
    event.currentTarget.querySelectorAll<HTMLButtonElement>('button')[next]?.focus();
  }}>
    <span className="segmented-selection" aria-hidden="true" style={{ transform: `translateX(${selection.left}px)`, width: selection.width }} />
    {options.map(option => <button key={option.value} type="button" data-subtle role={variant === 'radio' ? 'radio' : undefined} aria-label={option.ariaLabel}
      aria-checked={variant === 'radio' ? option.value === value : undefined} aria-pressed={variant === 'buttons' ? option.value === value : undefined}
      tabIndex={option.value === value ? 0 : -1} onClick={() => onChange(option.value)}>{option.icon}<span>{option.label}</span></button>)}
  </div>;
}
