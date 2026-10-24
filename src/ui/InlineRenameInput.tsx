import type { ComponentPropsWithoutRef } from 'react';
import { TextInput } from './TextInput';

export default function InlineRenameInput({ value, style, className, variant = 'field', ...props }: ComponentPropsWithoutRef<'input'> & { variant?: 'plain' | 'field' }) {
  return <span className="inline-rename-fit" style={style}>
    <TextInput {...props} variant={variant} value={value} className={`inline-rename-input ${className ?? ''}`} />
  </span>;
}
