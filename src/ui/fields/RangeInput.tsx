import { forwardRef, type ComponentPropsWithoutRef } from 'react';

export const RangeInput = forwardRef<HTMLInputElement, Omit<ComponentPropsWithoutRef<'input'>, 'type'>>(
  function RangeInput({ className, min = 0, max = 100, value, style, ...props }, ref) {
    const progress = Math.min(100, Math.max(0, (Number(value ?? min) - Number(min)) / (Number(max) - Number(min) || 1) * 100));
    return <input {...props} ref={ref} type="range" min={min} max={max} value={value}
      className={`range-input ${className ?? ''}`} style={{ ...style, backgroundSize: `${progress}% 4px` }} />;
  },
);
