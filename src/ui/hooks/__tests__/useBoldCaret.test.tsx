import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TextArea, TextInput } from '../../fields/TextInput';

const bar = () => document.querySelector<HTMLElement>('.text-caret');
const mirror = () => document.querySelector<HTMLElement>('.text-caret-mirror');

/** jsdom has no layout: a field reports a box and its caret marker sits inside that box. */
const box = { x: 100, y: 50, left: 100, top: 50, right: 300, bottom: 74, width: 200, height: 24 };
const marker = { x: 120, y: 52, left: 120, top: 52, right: 120, bottom: 70, width: 0, height: 18 };

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const rect = this instanceof HTMLInputElement || this instanceof HTMLTextAreaElement ? box : marker;
    return { ...rect, toJSON: () => rect } as DOMRect;
  });
});

afterEach(() => {
  cleanup();
  document.querySelectorAll('.text-caret, .text-caret-mirror').forEach(node => node.remove());
  vi.restoreAllMocks();
});

describe('shared bold caret', () => {
  it('paints over the hidden native caret while a field is focused', () => {
    render(<TextInput aria-label="Key" defaultValue="abc" />);
    const field = screen.getByLabelText('Key');
    expect(field).not.toHaveClass('text-caret-field');

    act(() => field.focus());
    expect(field).toHaveClass('text-caret-field');
    expect(bar()).not.toBeNull();
    expect(bar()!.hidden).toBe(false);
    // Marker box (120, 52, 18 high) inset by one pixel on both sides.
    expect(bar()!.style.left).toBe('120px');
    expect(bar()!.style.top).toBe('53px');
    expect(bar()!.style.height).toBe('16px');

    act(() => field.blur());
    expect(bar()!.hidden).toBe(true);
    expect(field).not.toHaveClass('text-caret-field');
  });

  it('measures from the text before the caret and follows the selection', () => {
    render(<TextInput aria-label="Host" defaultValue="alpha.test" />);
    const field = screen.getByLabelText('Host') as HTMLInputElement;
    act(() => field.focus());
    act(() => { field.setSelectionRange(5, 5); fireEvent.select(field); });
    expect(mirror()!.querySelector('span')!.textContent).toBe('.test');

    // A range selection shows no insertion point, so the native caret comes back.
    act(() => { field.setSelectionRange(0, 4); fireEvent.select(field); });
    expect(bar()!.hidden).toBe(true);
    expect(field).not.toHaveClass('text-caret-field');

    act(() => { field.setSelectionRange(9, 9); fireEvent.select(field); });
    expect(bar()!.hidden).toBe(false);
    expect(field).toHaveClass('text-caret-field');
  });

  it('mirrors a password as bullets so the plaintext never reaches the page', () => {
    render(<TextInput aria-label="Password" type="password" defaultValue="hunter2" />);
    const field = screen.getByLabelText('Password') as HTMLInputElement;
    act(() => field.focus());
    // The marker after the caret holds a zero-width character when nothing follows it.
    expect(mirror()!.textContent!.replace('\u200b', '')).toBe('•••••••');
    expect(document.body.textContent).not.toContain('hunter2');
    act(() => field.blur());
    expect(mirror()!.textContent).toBe('');
  });

  it('keeps the native caret for a field that opts out', () => {
    render(<TextArea aria-label="Command" boldCaret={false} defaultValue="npm run dev" />);
    const field = screen.getByLabelText('Command');
    act(() => field.focus());
    expect(field).not.toHaveClass('text-caret-field');
    expect(bar()?.hidden ?? true).toBe(true);
  });

  it('uses one text fragment when the remaining text spans multiple lines', () => {
    vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([marker] as unknown as DOMRectList);
    render(<TextArea aria-label="Reply" defaultValue={'first\nsecond\nthird'} />);
    const field = screen.getByLabelText('Reply') as HTMLTextAreaElement;
    act(() => { field.focus(); field.setSelectionRange(2, 2); fireEvent.select(field); });
    expect(bar()!.style.top).toBe('53px');
    expect(bar()!.style.height).toBe('16px');
  });

  it('hides the caret when scrolling moves its text outside the field', () => {
    let top = 52;
    vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(() => [{ ...marker, top, bottom: top + 18 }] as unknown as DOMRectList);
    render(<TextArea aria-label="Reply" defaultValue={'first\nsecond\nthird'} />);
    const field = screen.getByLabelText('Reply');
    act(() => field.focus());
    expect(bar()!.hidden).toBe(false);
    top = -50;
    fireEvent.scroll(field);
    expect(bar()!.hidden).toBe(true);
    top = 52;
    fireEvent.scroll(field);
    expect(bar()!.hidden).toBe(false);
  });

  it('preserves consecutive spaces when measuring a single-line field', () => {
    render(<TextInput aria-label="Path" defaultValue="a    b" />);
    act(() => screen.getByLabelText('Path').focus());
    expect(mirror()!.style.whiteSpace).toBe('pre');
  });
});
