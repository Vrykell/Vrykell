import { afterEach, expect, it } from 'vitest';
import { guardModalComposition } from '@ui/editor/code/modalCompositionGuard';

const types = ['compositionstart', 'compositionupdate', 'compositionend', 'beforeinput', 'input'] as const;
const compositionEvents = ['compositionstart', 'compositionupdate', 'input', 'compositionupdate', 'input', 'compositionend', 'input'];

function setup(value = '', accepts = false) {
  const host = document.createElement('div');
  const textarea = document.createElement('textarea');
  host.append(textarea);
  document.body.append(host);
  textarea.value = value;
  let accepting = accepts;
  const seen: string[] = [];
  for (const type of types) textarea.addEventListener(type, () => seen.push(type));
  const dispose = guardModalComposition(host, () => accepting);
  return { host, textarea, seen, dispose, setAccepting: (next: boolean) => { accepting = next; } };
}

function compose(textarea: HTMLTextAreaElement, preedit = 'nihao', committed = '你好') {
  textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  textarea.value = preedit;
  textarea.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: preedit }));
  textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: preedit, isComposing: true }));
  textarea.value = committed;
  textarea.setSelectionRange(committed.length, committed.length);
  textarea.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: committed }));
  textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: committed, isComposing: true }));
  textarea.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: committed }));
  textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: committed, isComposing: false }));
}

afterEach(() => { document.body.replaceChildren(); });

it('stops composition outside text input modes and restores the hidden input', () => {
  const { textarea, seen, dispose } = setup('draft');
  textarea.setSelectionRange(2, 2);
  compose(textarea);
  // The trailing native input after the composition end is harmless because the value is restored.
  expect(seen).toEqual(['input']);
  expect(textarea.value).toBe('draft');
  expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([2, 2]);
  dispose();
});

it('delivers composition unchanged while the editor accepts text', () => {
  const { textarea, seen, dispose } = setup('', true);
  compose(textarea);
  expect(seen).toEqual(compositionEvents);
  expect(textarea.value).toBe('你好');
  dispose();
});

it('keeps the mode that was active when the composition started', () => {
  const { textarea, seen, dispose, setAccepting } = setup('');
  textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  setAccepting(true);
  textarea.value = '你好';
  textarea.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: '你好' }));
  textarea.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '你好' }));
  expect(seen).toEqual([]);
  expect(textarea.value).toBe('');
  dispose();
});

it('passes ordinary input outside a blocked composition', () => {
  const { textarea, seen, dispose } = setup('');
  textarea.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: 'a' }));
  textarea.value = 'a';
  textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'a' }));
  expect(seen).toEqual(['beforeinput', 'input']);
  dispose();
});

it('restores an active blocked composition when the guard is disposed', () => {
  const { textarea, dispose } = setup('draft');
  textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  textarea.value = 'nihao';
  dispose();
  expect(textarea.value).toBe('draft');
});

it('releases a composition interrupted by blur and removes every listener on disposal', () => {
  const { host, textarea, seen, dispose } = setup('draft');
  textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  textarea.value = 'nihao';
  textarea.dispatchEvent(new Event('blur'));
  expect(textarea.value).toBe('draft');
  textarea.value = 'draft!';
  textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '!' }));
  expect(seen).toEqual(['input']);
  dispose();
  textarea.value = '';
  compose(textarea);
  expect(seen.slice(1)).toEqual(compositionEvents);
  expect(host.contains(textarea)).toBe(true);
});
