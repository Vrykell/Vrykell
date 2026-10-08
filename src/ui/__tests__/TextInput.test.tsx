import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TextInput, TextArea, configureLiteralInput } from '../TextInput';

afterEach(cleanup);

describe('literal text input', () => {
  it.each([TextInput, TextArea])('disables native substitutions while retaining composition and changes', Component => {
    const change = vi.fn();
    const compose = vi.fn();
    render(<Component aria-label="Command" defaultValue="npm" autoCorrect="on" autoCapitalize="sentences" spellCheck onChange={change} onCompositionEnd={compose} />);
    const input = screen.getByRole('textbox');
    expect(input).toHaveAttribute('autocorrect', 'off');
    expect(input).toHaveAttribute('autocapitalize', 'off');
    expect(input).toHaveAttribute('spellcheck', 'false');
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: 'npm 中文' } });
    fireEvent.compositionEnd(input, { data: '中文' });
    expect(input).toHaveValue('npm 中文');
    expect(change).toHaveBeenCalledOnce();
    expect(compose).toHaveBeenCalledOnce();
  });

  it('forwards focus refs and preserves passwords', () => {
    const ref = createRef<HTMLInputElement>();
    render(<TextInput ref={ref} type="password" aria-label="Secret" />);
    ref.current?.focus();
    expect(screen.getByLabelText('Secret')).toHaveFocus();
    expect(ref.current?.type).toBe('password');
  });

  it('applies the same policy to renderer-owned inputs', () => {
    const input = document.createElement('textarea');
    configureLiteralInput(input);
    expect(input.autocomplete).toBe('off');
    expect(input.spellcheck).toBe(false);
    expect(input.getAttribute('autocorrect')).toBe('off');
  });
});
