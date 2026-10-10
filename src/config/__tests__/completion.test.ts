import { afterEach, describe, expect, it } from 'vitest';
import { acceptsCompletionKey, completionShortcut, useCompletionPreferences, validCustomCompletionShortcut } from '../completion';

const key = (value: string, modifiers = {}) => ({ key: value, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, ...modifiers });

describe('completion acceptance keys', () => {
  const snapshot = useCompletionPreferences.getState();
  afterEach(() => useCompletionPreferences.setState(snapshot, true));

  it('accepts right-arrow only at the end without a selection and respects enabled keys', () => {
    expect(acceptsCompletionKey(key('ArrowRight'), ['ArrowRight'], 3, 3, 3)).toBe(true);
    expect(acceptsCompletionKey(key('ArrowRight'), ['ArrowRight'], 1, 1, 3)).toBe(false);
    expect(acceptsCompletionKey(key('ArrowRight'), ['ArrowRight'], 1, 3, 3)).toBe(false);
    expect(acceptsCompletionKey(key('ArrowRight', { shiftKey: true }), ['ArrowRight'], 3, 3, 3)).toBe(false);
    expect(acceptsCompletionKey(key('ArrowRight', { shiftKey: true }), ['Shift+ArrowRight'], 3, 3, 3)).toBe(true);
    expect(acceptsCompletionKey(key('Tab', { shiftKey: true }), ['Tab'], 3, 3, 3)).toBe(true);
    expect(acceptsCompletionKey(key('Tab'), ['ArrowRight'], 3, 3, 3)).toBe(false);
  });

  it('preserves plain typing and normal navigation while supporting modified characters', () => {
    expect(completionShortcut(key('j'))).toBeUndefined();
    expect(completionShortcut(key('ArrowUp'))).toBeUndefined();
    expect(completionShortcut(key('Enter', { ctrlKey: true }))).toBeUndefined();
    expect(completionShortcut(key('j', { ctrlKey: true }))).toBe('Control+J');
    expect(validCustomCompletionShortcut('Shift+J')).toBe(false);
    expect(validCustomCompletionShortcut('Control+J')).toBe(true);
  });

  it('persists multiple enabled keys and replaces a custom binding without losing preset choices', async () => {
    const prefs = useCompletionPreferences.getState();
    prefs.toggle('Tab'); prefs.toggle('Shift+ArrowRight'); prefs.setCustom('Control+J');
    prefs.setCustom('Control+K'); prefs.setCustom('Enter');
    expect(useCompletionPreferences.getState().shortcuts).toEqual(['ArrowRight', 'Shift+ArrowRight', 'Control+K']);
    expect(JSON.parse(localStorage.getItem('vrykell-completion')!).state.customShortcut).toBe('Control+K');
    await useCompletionPreferences.persist.rehydrate();
    expect(useCompletionPreferences.getState().customShortcut).toBe('Control+K');
  });

  it('rejects invalid saved bindings and always keeps an acceptance key', async () => {
    localStorage.setItem('vrykell-completion', JSON.stringify({ state: { shortcuts: ['Enter', null], customShortcut: 'Enter' }, version: 0 }));
    await useCompletionPreferences.persist.rehydrate();
    expect(useCompletionPreferences.getState().shortcuts).toEqual(['ArrowRight', 'Tab']);
    useCompletionPreferences.getState().toggle('Tab');
    useCompletionPreferences.getState().toggle('ArrowRight');
    useCompletionPreferences.getState().toggle('Enter');
    expect(useCompletionPreferences.getState().shortcuts).toEqual(['ArrowRight']);
  });
});
