import { forwardRef, type ComponentPropsWithoutRef } from 'react';

/** Neutral outlined actions share pointer, keyboard and disabled feedback. */
export const OutlineButton = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<'button'>>(
  function OutlineButton({ className = '', ...props }, ref) {
    return <button type="button" {...props} ref={ref} className={`outline-button ${className}`} />;
  },
);
