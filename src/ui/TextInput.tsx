import { forwardRef, type ComponentPropsWithoutRef } from 'react';

/** Preserve literal input across native text services without changing composition events. */
export const literalInputProps = {
  autoCorrect: 'off',
  autoCapitalize: 'off',
  spellCheck: false,
  autoComplete: 'off',
} as const;

export const TextInput = forwardRef<HTMLInputElement, ComponentPropsWithoutRef<'input'> & { variant?: 'plain' | 'field' }>(
  function TextInput({ variant = 'plain', className, ...props }, ref) {
    return <input {...props} {...literalInputProps} ref={ref} className={variant === 'field' ? `text-input-field ${className ?? ''}` : className} />;
  },
);

export const TextArea = forwardRef<HTMLTextAreaElement, ComponentPropsWithoutRef<'textarea'>>(
  function TextArea(props, ref) {
    return <textarea {...props} {...literalInputProps} ref={ref} />;
  },
);

/** Apply the shared policy to an input owned by an external terminal renderer. */
export function configureLiteralInput(element: HTMLInputElement | HTMLTextAreaElement): void {
  element.setAttribute('autocorrect', literalInputProps.autoCorrect);
  element.setAttribute('autocapitalize', literalInputProps.autoCapitalize);
  element.spellcheck = literalInputProps.spellCheck;
  element.autocomplete = literalInputProps.autoComplete;
}
