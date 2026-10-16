import { forwardRef, type ComponentPropsWithoutRef } from 'react';

/** Neutral actions share a visible surface, centered content and focus feedback. */
export const OutlineButton = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<'button'>>(
  function OutlineButton({ className = '', ...props }, ref) {
    return <button type="button" {...props} ref={ref} className={`outline-button ${className}`} />;
  },
);
