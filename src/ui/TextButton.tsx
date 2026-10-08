import { forwardRef, type ComponentPropsWithoutRef } from 'react';

/** Compact labeled controls share themed hover, focus and disabled states. */
export const TextButton = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<'button'>>(
  function TextButton({ className = '', ...props }, ref) {
    return <button type="button" {...props} ref={ref} className={`text-control ${className}`} />;
  },
);
