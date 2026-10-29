import { forwardRef, type ComponentPropsWithoutRef } from 'react';

/** Neutral actions share a visible surface, centered content and focus feedback. */
export const OutlineButton = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<'button'> & { tone?: 'neutral' | 'danger' }>(
  function OutlineButton({ className = '', tone = 'neutral', ...props }, ref) {
    return <button type="button" {...props} ref={ref} data-tone={tone} className={`outline-button ${className}`} />;
  },
);
