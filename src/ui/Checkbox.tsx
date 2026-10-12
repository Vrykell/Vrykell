import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import { Check } from './icons';

/** A native accessible checkbox with the shared neutral theme and a vector checkmark. */
export const Checkbox = forwardRef<HTMLInputElement, ComponentPropsWithoutRef<'input'>>(
  function Checkbox({ className = '', style, ...props }, ref) {
    return <span className="themed-checkbox" style={style}>
      <input {...props} type="checkbox" className={className} ref={ref} />
      <Check size={12} aria-hidden="true" style={{ color: 'var(--field-bg)' }} />
    </span>;
  },
);
