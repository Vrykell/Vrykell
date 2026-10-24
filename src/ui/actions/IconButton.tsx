import { forwardRef, type ComponentPropsWithoutRef } from 'react';

export type ControlTone = 'neutral' | 'accent' | 'warning' | 'danger';

/** Shared icon targets inherit all visual states from the active theme. */
export const IconButton = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<'button'> & { compact?: boolean; tone?: ControlTone }>(
  function IconButton({ compact = false, tone = 'neutral', className = '', ...props }, ref) {
    return <button type="button" {...props} ref={ref} data-compact={compact}
      data-tone={tone} className={`icon-button ${className}`} />;
  },
);
