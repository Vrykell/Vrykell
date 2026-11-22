import { forwardRef, type ComponentPropsWithoutRef } from 'react';

/** A pane's status and actions share its bottom edge with the scrolling content. */
export const PaneStatusFooter = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<'div'>>(function PaneStatusFooter(
  { className = '', ...props },
  ref,
) {
  return <div ref={ref} {...props} className={`pane-status-footer ${className}`} />;
});
