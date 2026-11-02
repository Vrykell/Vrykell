import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TextInput, TextArea, configureLiteralInput } from '@ui/fields/TextInput';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('literal text input', () => {
  it.each([TextInput, TextArea])('applies the shared field presentation on request', Component => {
    render(<Component variant="field" aria-label="Field" />);
    expect(screen.getByRole('textbox')).toHaveClass('text-input-field');
  });
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

  it('keeps long text readable within a bounded field and preserves textarea refs and styles', () => {
    vi.spyOn(HTMLTextAreaElement.prototype, 'clientWidth', 'get').mockReturnValue(300);
    vi.spyOn(HTMLTextAreaElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLTextAreaElement) {
      return this.value.includes('\n') ? 400 : 40;
    });
    const ref = createRef<HTMLTextAreaElement>();
    const style = { boxSizing: 'border-box', border: '1px solid', resize: 'vertical', minHeight: 20 } as const;
    const { rerender } = render(<TextArea ref={ref} aria-label="Notes" value="short" readOnly autoSizeMaxHeight={120} style={style} />);
    const input = screen.getByLabelText('Notes');
    expect(ref.current).toBe(input);
    expect(input).toHaveStyle({ height: '42px', resize: 'none', minHeight: '20px', overflowY: 'hidden' });
    ref.current?.focus();
    const long = 'first\nsecond\nthird';
    rerender(<TextArea ref={ref} aria-label="Notes" value={long} readOnly autoSizeMaxHeight={120} style={style} />);
    expect(input).toHaveStyle({ height: '120px', overflowY: 'auto' });
    expect(input).toHaveValue(long);
    expect(input).toHaveFocus();
    rerender(<TextArea ref={ref} aria-label="Notes" value={`${long}\nmore`} readOnly autoSizeMaxHeight={120} style={{ ...style, maxHeight: 80 }} />);
    expect(input).toHaveStyle({ height: '80px', overflowY: 'auto' });
    rerender(<TextArea ref={ref} aria-label="Notes" value="short" readOnly autoSizeMaxHeight={120} style={style} />);
    expect(input).toHaveStyle({ height: '42px', overflowY: 'hidden' });
  });

  it('applies the same policy to renderer-owned inputs', () => {
    const input = document.createElement('textarea');
    configureLiteralInput(input);
    expect(input.autocomplete).toBe('off');
    expect(input.spellcheck).toBe(false);
    expect(input.getAttribute('autocorrect')).toBe('off');
  });
});
