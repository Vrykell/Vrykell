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
  const key = () => textarea.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'i', keyCode: 73 }));
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

it('keeps candidate keys and insertText native until the composition helper commits', async () => {
  const element = document.createElement('div');
  element.innerHTML = '<textarea></textarea>';
  const textarea = element.querySelector('textarea')!;
  const input = vi.fn();
  configureTerminalInput({ element, textarea, options: {}, input } as unknown as Terminal);
  const terminalKey = vi.fn();
  const terminalInput = vi.fn();
  textarea.addEventListener('keydown', terminalKey, { capture: true });
  textarea.addEventListener('input', terminalInput, { capture: true });
  textarea.dispatchEvent(new CompositionEvent('compositionstart'));
  for (const key of ['ArrowDown', 'Enter', 'Backspace', 'Escape']) {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key });
    textarea.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  }
  textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'candidate' }));
  textarea.dispatchEvent(new CompositionEvent('compositionend'));
  textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteCompositionText' }));
  terminalInput.mockClear();
  textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'committed' }));
  await new Promise(resolve => setTimeout(resolve, 5));
  expect(terminalKey).not.toHaveBeenCalled();
  expect(terminalInput).not.toHaveBeenCalled();
  expect(input).not.toHaveBeenCalled();
  textarea.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a' }));
  expect(terminalKey).toHaveBeenCalledOnce();
});

it('leaves native diff keys to xterm even when their textarea update arrives later', async () => {
  const element = document.createElement('div');
  element.innerHTML = '<textarea></textarea>';
  const textarea = element.querySelector('textarea')!;
  const input = vi.fn();
  configureTerminalInput({ element, textarea, options: {}, input } as unknown as Terminal);
  textarea.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, keyCode: 229 }));
  textarea.value = 'punctuation';
  textarea.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: 'punctuation' }));
  await new Promise(resolve => setTimeout(resolve, 5));
  expect(input).not.toHaveBeenCalled();
  expect(textarea.value).toBe('punctuation');
});

it('ignores orphan composition ends without blocking paired ends or native punctuation', () => {
  const element = document.createElement('div');
  element.innerHTML = '<textarea></textarea>';
  const textarea = element.querySelector('textarea')!;
  configureTerminalInput({ element, textarea, options: {} } as unknown as Terminal);
  const end = vi.fn();
  const key = vi.fn();
  textarea.addEventListener('compositionend', end);
  textarea.addEventListener('keydown', key);
  textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  textarea.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'text' }));
  expect(end).toHaveBeenCalledOnce();
  textarea.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, keyCode: 229 }));
  expect(key).toHaveBeenCalledOnce();
  textarea.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: ',' }));
  textarea.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' }));
  expect(end).toHaveBeenCalledOnce();
  textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  textarea.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'next' }));
  expect(end).toHaveBeenCalledTimes(2);
});
