import { describe, it, expect, beforeEach } from 'vitest';
import { useInputStore, selectPaneInput } from '@features/terminal/stores/input';

const initial = useInputStore.getState();

describe('input store (independent input state per pane)', () => {
  beforeEach(() => useInputStore.setState(initial, true));

  it('stages scripts after a preserved command draft without consuming the AI draft', () => {
    const store = useInputStore.getState();
    store.setText('a', 'echo existing');
    store.setAiMode('a', true);
    store.setText('a', 'explain this');
    store.stageText('a', 'echo one\necho two');
    expect(selectPaneInput('a')(useInputStore.getState())).toMatchObject({
      aiMode: false, text: 'echo existing\necho one\necho two', aiDraft: 'explain this', focusRequest: 1,
    });
    expect(useInputStore.getState().byPane.b).toBeUndefined();
    store.stageText('a', 'echo three');
    expect(useInputStore.getState().byPane.a?.focusRequest).toBe(2);
  });

  it('isolates setText / setAiMode per pane', () => {
    useInputStore.getState().setText('a', 'ls');
    useInputStore.getState().setAiMode('a', true);
    useInputStore.getState().setText('a', '解释这个项目');
    useInputStore.getState().setText('b', 'pwd');

    expect(selectPaneInput('a')(useInputStore.getState())).toMatchObject({ text: '解释这个项目', aiMode: true, commandDraft: 'ls' });
    expect(selectPaneInput('b')(useInputStore.getState())).toEqual({ text: 'pwd', aiMode: false });
  });

  it('clearText clears the text but keeps AI mode', () => {
    useInputStore.getState().setText('a', 'ls');
    useInputStore.getState().setAiMode('a', true);
    useInputStore.getState().clearText('a');

    expect(selectPaneInput('a')(useInputStore.getState())).toMatchObject({ text: '', aiMode: true });
  });

  it('dropPane removes the pane state', () => {
    useInputStore.getState().setText('a', 'ls');
    useInputStore.getState().dropPane('a');
    expect(useInputStore.getState().byPane['a']).toBeUndefined();
  });

  it('selectPaneInput returns a stable empty state when missing (avoids infinite re-renders)', () => {
    const s1 = selectPaneInput('missing')(useInputStore.getState());
    const s2 = selectPaneInput('missing')(useInputStore.getState());
    expect(s1).toEqual({ text: '', aiMode: false });
    expect(s1).toBe(s2);
  });
});
