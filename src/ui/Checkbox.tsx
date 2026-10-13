import { forwardRef, type ComponentPropsWithoutRef } from 'react';

/** A native checkbox with the active theme's accent color. */
export const Checkbox = forwardRef<HTMLInputElement, ComponentPropsWithoutRef<'input'>>(
  function Checkbox({ className = '', style, ...props }, ref) {
    return <input {...props} type="checkbox" className={`themed-checkbox ${className}`} style={style} ref={ref} />;
  },
);
