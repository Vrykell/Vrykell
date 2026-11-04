import { forwardRef, useImperativeHandle, useRef, type ComponentPropsWithoutRef } from 'react';
import { localizeLabel } from '@i18n';
import { useAutoSizeTextarea } from '../hooks/useAutoSizeTextarea';
import { useBoldCaret } from '../hooks/useBoldCaret';

/** Preserve literal input across native text services without changing composition events. */
export const literalInputProps = {
  autoCorrect: 'off',
  autoCapitalize: 'off',
  spellCheck: false,
  autoComplete: 'off',
} as const;

/** A field owns its element so the shared caret can measure it; the caller's ref stays identical. */
export const TextInput = forwardRef<HTMLInputElement, ComponentPropsWithoutRef<'input'> & { variant?: 'plain' | 'field' }>(
  function TextInput({ variant = 'plain', className, ...props }, ref) {
    const element = useRef<HTMLInputElement>(null);
    useImperativeHandle(ref, () => element.current!, []);
    useBoldCaret(element);
    return <input {...props} placeholder={localizeLabel(props.placeholder)} aria-label={localizeLabel(props['aria-label'])} {...literalInputProps} ref={element} className={variant === 'field' ? `text-input-field ${className ?? ''}` : className} />;
  },
);

export const TextArea = forwardRef<HTMLTextAreaElement, ComponentPropsWithoutRef<'textarea'> & { variant?: 'plain' | 'field'; autoSizeMaxHeight?: number; boldCaret?: boolean }>(
  function TextArea({ variant = 'plain', className, style, autoSizeMaxHeight, boldCaret = true, ...props }, ref) {
    const element = useRef<HTMLTextAreaElement>(null);
    useImperativeHandle(ref, () => element.current!, []);
    useAutoSizeTextarea(element, String(props.value ?? props.defaultValue ?? ''), autoSizeMaxHeight ?? 120, autoSizeMaxHeight !== undefined);
    // The terminal command line paints its own syntax mirror over this element and keeps the
    // native caret, so it turns the shared caret off instead of stacking two insertion points.
    useBoldCaret(element, boldCaret);
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
