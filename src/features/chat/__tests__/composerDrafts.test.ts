import { beforeEach, describe, expect, it } from 'vitest';
import { useComposerDrafts } from '@features/chat/stores/composerDrafts';
import { makePasteAttachment } from '@features/agent/model/attachments';
import { useChatStore } from '@features/chat/stores/chat';

describe('session composer drafts', () => {
  beforeEach(() => useComposerDrafts.setState({ byTab: {} }));

  it('isolates text and attachments and clears only the closed session', () => {
    const store = useComposerDrafts.getState();
    const attachment = makePasteAttachment('context');
    store.setText('one', 'first task');
    store.updateAttachments('one', () => [attachment]);
    store.setText('two', 'second task');
    expect(useComposerDrafts.getState().byTab.one).toEqual({ text: 'first task', attachments: [attachment] });
    expect(useComposerDrafts.getState().byTab.two).toEqual({ text: 'second task', attachments: [] });
    store.dropTab('one');
    expect(useComposerDrafts.getState().byTab.one).toBeUndefined();
    expect(useComposerDrafts.getState().byTab.two?.text).toBe('second task');
  });

  it('restores an edited message and its attachments to the original session', () => {
    const attachment = makePasteAttachment('original context');
    const previous = useChatStore.getState();
    useComposerDrafts.getState().setText('other', 'unrelated task');
    useChatStore.setState({
      sendingTabs: [],
      byTab: { one: [{ id: 'question', role: 'user', content: 'retry this', attachments: [attachment], createdAt: 1 }] },
    });
    try {
      useChatStore.getState().editResend('one', 'question');
      expect(useComposerDrafts.getState().byTab.one).toEqual({ text: 'retry this', attachments: [attachment] });
      expect(useComposerDrafts.getState().byTab.other?.text).toBe('unrelated task');
    } finally {
      useChatStore.setState(previous, true);
    }
  });
});
