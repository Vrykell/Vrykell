import type { ComponentPropsWithoutRef } from 'react';

/** Panel placement, splitting and moving share one themed target surface. */
export default function DropPlacementPreview({ active = true, className = '', ...props }:
  ComponentPropsWithoutRef<'div'> & { active?: boolean }) {
  return <div {...props} className={`drop-placement-preview ${className}`} data-active={active} />;
}
