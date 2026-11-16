import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState, type ComponentPropsWithoutRef } from 'react';
import { IconButton } from '@ui/actions/IconButton';
import { localizeLabel, t } from '@i18n';
import { Eye, EyeOff, iconSizes } from '@ui/icons';
import { literalInputProps } from '@ui/fields/TextInput';
import '@ui/fields/PasswordInput.css';

type Props = Omit<ComponentPropsWithoutRef<'input'>, 'type'> & {
  /** Passing an explicit label keeps provider key fields from reading as account passwords. */
  revealLabel?: { show: string; hide: string };
  revealTestId?: string;
};

/**
 * Password fields own the reveal control. The WebView's native eye cannot be themed, moves the
 * caret when pressed and only appears after typing, so it stays hidden and this button replaces it.
 */
const PasswordInput = forwardRef<HTMLInputElement, Props>(function PasswordInput({ className, style, disabled, revealLabel, revealTestId, ...props }, ref) {
  const element = useRef<HTMLInputElement>(null);
  /** Caret captured before the type change; switching type can reset the selection. */
  const caret = useRef<{ start: number; end: number } | null>(null);
  const toggled = useRef(false);
  const [revealed, setRevealed] = useState(false);
  useImperativeHandle(ref, () => element.current!, []);
  useLayoutEffect(() => {
    if (!toggled.current) return;
    const input = element.current;
    if (!input) return;
    input.focus({ preventScroll: true });
    if (caret.current) input.setSelectionRange(caret.current.start, caret.current.end);
  }, [revealed]);
  const toggle = () => {
    const input = element.current;
    if (input) caret.current = { start: input.selectionStart ?? 0, end: input.selectionEnd ?? 0 };
    toggled.current = true;
    setRevealed(value => !value);
  };
  const label = revealLabel ? t(revealed ? revealLabel.hide : revealLabel.show) : t(revealed ? 'Hide password' : 'Show password');
  return <span className="password-input">
    <input {...props} {...literalInputProps} ref={element} disabled={disabled}
      type={revealed ? 'text' : 'password'}
      placeholder={localizeLabel(props.placeholder)}
      aria-label={localizeLabel(props['aria-label'])}
      className={`text-input-field ${className ?? ''}`}
      style={style} />
    <IconButton compact data-subtle disabled={disabled} className="password-input-reveal"
      data-testid={revealTestId}
      aria-pressed={revealed}
      aria-label={label}
      data-tip={label}
      onMouseDown={event => event.preventDefault()}
      onClick={toggle}>
      {revealed ? <EyeOff size={iconSizes.compact} /> : <Eye size={iconSizes.compact} />}
    </IconButton>
  </span>;
});

export default PasswordInput;
