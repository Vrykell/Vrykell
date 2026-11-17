import { createRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { t } from '@i18n';
import PasswordInput from '@ui/fields/PasswordInput';

afterEach(() => cleanup());

describe('password input', () => {
  it('starts masked and reveals the value through the in-field control', () => {
    render(<PasswordInput aria-label="Password" defaultValue="secret" />);
    const input = screen.getByLabelText('Password');
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveClass('text-input-field');
    const reveal = screen.getByRole('button', { name: t('Show password') });
    expect(reveal).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(reveal);
    expect(input).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: t('Hide password') })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: t('Hide password') }));
    expect(input).toHaveAttribute('type', 'password');
  });

  it('keeps focus and the caret in place while toggling', () => {
    render(<PasswordInput aria-label="Password" defaultValue="secret" />);
    const input = screen.getByLabelText('Password') as HTMLInputElement;
    input.focus();
    input.setSelectionRange(2, 2);
    fireEvent.click(screen.getByRole('button', { name: t('Show password') }));
    expect(input).toHaveFocus();
    expect(input.selectionStart).toBe(2);
    expect(input.selectionEnd).toBe(2);
  });

  it('forwards the ref, honors disabled and accepts provider-specific reveal labels', () => {
    const ref = createRef<HTMLInputElement>();
    render(
      <PasswordInput
        ref={ref}
        aria-label="API key"
        disabled
        revealTestId="key-reveal"
        revealLabel={{ show: 'Reveal API key', hide: 'Hide API key' }}
      />,
    );
    expect(ref.current).toBe(screen.getByLabelText('API key'));
    expect(ref.current).toBeDisabled();
    const reveal = screen.getByTestId('key-reveal');
    expect(reveal).toBeDisabled();
    expect(reveal).toHaveAccessibleName(t('Reveal API key'));
  });
});
