import type { Terminal } from '@xterm/xterm';
import { describe, expect, it, vi } from 'vitest';
import { configureTerminalInput } from '../model/terminalInput';

describe('terminal composition placement', () => {
  it('starts preedit at the cursor instead of flashing at the helper origin', () => {
    const element = document.createElement('div');
    element.innerHTML = '<textarea></textarea><div class="composition-view"></div>';
    const textarea = element.querySelector('textarea')!;
    textarea.style.left = '120px';
    textarea.style.top = '80px';
    textarea.style.lineHeight = '14px';
    const term = { element, textarea, options: { fontFamily: 'monospace', fontSize: 14 } } as unknown as Terminal;
    configureTerminalInput(term);
    configureTerminalInput(term);
    textarea.dispatchEvent(new CompositionEvent('compositionstart'));
    const view = element.querySelector<HTMLElement>('.composition-view')!;
    expect(view.style.left).toBe('120px');
    expect(view.style.top).toBe('80px');
    expect(view.style.fontFamily).toBe('monospace');
    expect(textarea.getAttribute('autocorrect')).toBe('off');
  });
});

it('forwards an otherwise unhandled native text commit once and preserves composition', async () => {
  const element = document.createElement('div');
  element.innerHTML = '<textarea></textarea>';
  document.body.append(element);
  const textarea = element.querySelector('textarea')!;
  let onData = () => {};
  const input = vi.fn(() => onData());
  const term = { element, textarea, options: {}, input,
    onData: (callback: () => void) => { onData = callback; } } as unknown as Terminal;
  configureTerminalInput(term);
  const key = () => textarea.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Unidentified', keyCode: 229 }));
  const commit = () => textarea.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: 'i' }));
  key(); commit();
  await new Promise(resolve => setTimeout(resolve, 5));
  expect(input).toHaveBeenCalledExactlyOnceWith('i', true);
  key(); onData(); commit();
  await new Promise(resolve => setTimeout(resolve, 5));
  expect(input).toHaveBeenCalledTimes(1);
  key(); textarea.dispatchEvent(new CompositionEvent('compositionstart')); commit();
  textarea.dispatchEvent(new CompositionEvent('compositionend')); commit();
  expect(input).toHaveBeenCalledTimes(1);
  element.remove();
});

it('does not duplicate a preedit that an IME switch commits right after composition ends', async () => {
  const element = document.createElement('div');
  element.innerHTML = '<textarea></textarea>';
  document.body.append(element);
  const textarea = element.querySelector('textarea')!;
  let onData = () => {};
  const input = vi.fn(() => onData());
  const term = { element, textarea, options: {}, input,
    onData: (callback: () => void) => { onData = callback; } } as unknown as Terminal;
  configureTerminalInput(term);
  const key = () => textarea.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, keyCode: 229 }));
  const commit = (data: string) => textarea.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data }));

  // Type pinyin without picking a candidate, then switch the IME to English: the switch
  // commits the pending preedit and xterm forwards it once through onData.
  textarea.dispatchEvent(new CompositionEvent('compositionstart'));
  commit('nihao');
  textarea.dispatchEvent(new CompositionEvent('compositionend'));
  onData();
  // The switch keydown lands after that commit; the late native diff must not resend it.
  key();
  commit('nihao');
  await new Promise(resolve => setTimeout(resolve, 5));
  expect(input).not.toHaveBeenCalled();
  element.remove();
});

it('lets the delayed native IME diff commit before applying an input fallback', async () => {
  const element = document.createElement('div');
  element.innerHTML = '<textarea></textarea>';
  document.body.append(element);
  const textarea = element.querySelector('textarea')!;
  let onData = () => {};
  const input = vi.fn(() => onData());
  const term = { element, textarea, options: {}, input,
    onData: (callback: () => void) => { onData = callback; } } as unknown as Terminal;
  // The parser schedules its native textarea diff during keydown.
  textarea.addEventListener('keydown', () => {
    setTimeout(() => { if (textarea.value === 'x') onData(); }, 0);
  }, { capture: true });
  configureTerminalInput(term);
  textarea.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, keyCode: 229 }));
  textarea.value = 'x';
  textarea.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: 'x' }));
  expect(textarea.value).toBe('x');
  await new Promise(resolve => setTimeout(resolve, 5));
  expect(input).not.toHaveBeenCalled();
  element.remove();
});
