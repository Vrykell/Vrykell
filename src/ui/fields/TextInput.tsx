import { forwardRef, useImperativeHandle, useRef, type ComponentPropsWithoutRef } from 'react';
import { localizeLabel } from '@i18n';
import { useAutoSizeTextarea } from '../hooks/useAutoSizeTextarea';

/** Preserve literal input across native text services without changing composition events. */
export const literalInputProps = {
  autoCorrect: 'off',
  autoCapitalize: 'off',
  spellCheck: false,
  autoComplete: 'off',
} as const;

export const TextInput = forwardRef<HTMLInputElement, ComponentPropsWithoutRef<'input'> & { variant?: 'plain' | 'field' }>(
  function TextInput({ variant = 'plain', className, ...props }, ref) {
    return <input {...props} placeholder={localizeLabel(props.placeholder)} aria-label={localizeLabel(props['aria-label'])} {...literalInputProps} ref={ref} className={variant === 'field' ? `text-input-field ${className ?? ''}` : className} />;
  },
);

export const TextArea = forwardRef<HTMLTextAreaElement, ComponentPropsWithoutRef<'textarea'> & { variant?: 'plain' | 'field'; autoSizeMaxHeight?: number }>(
  function TextArea({ variant = 'plain', className, style, autoSizeMaxHeight, ...props }, ref) {
    const element = useRef<HTMLTextAreaElement>(null);
    useImperativeHandle(ref, () => element.current!, []);
    useAutoSizeTextarea(element, String(props.value ?? props.defaultValue ?? ''), autoSizeMaxHeight ?? 120, autoSizeMaxHeight !== undefined);
    return <textarea {...props} placeholder={localizeLabel(props.placeholder)} aria-label={localizeLabel(props['aria-label'])} {...literalInputProps} ref={element} style={{ ...style, resize: 'none' }} className={variant === 'field' ? `text-input-field ${className ?? ''}` : className} />;
  },
);

/** Apply the shared policy to an input owned by an external terminal renderer. */
export function configureLiteralInput(element: HTMLInputElement | HTMLTextAreaElement): void {
  element.setAttribute('autocorrect', literalInputProps.autoCorrect);
  element.setAttribute('autocapitalize', literalInputProps.autoCapitalize);
  element.spellcheck = literalInputProps.spellCheck;
  element.autocomplete = literalInputProps.autoComplete;
}
