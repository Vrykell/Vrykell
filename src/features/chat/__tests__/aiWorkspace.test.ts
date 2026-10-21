import { afterEach, expect, it, vi } from 'vitest';
import { useAiWorkspace } from '../stores/aiWorkspace';
import { closeAiWorkspaceSession } from '../services/aiWorkspace';
import { useChatStore } from '../stores/chat';
import { useComposerDrafts } from '../stores/composerDrafts';
const snapshot = useAiWorkspace.getState();
afterEach(() => { useAiWorkspace.setState(snapshot, true); vi.restoreAllMocks(); });

it('closes a navigation tab without deleting the saved conversation, draft or messages', () => {
  const deleteConversation = vi.spyOn(useChatStore.getState(), 'deleteConversation');
  useComposerDrafts.getState().setText('native-a', 'Keep this draft');
  useAiWorkspace.getState().openNative('native-a');
  closeAiWorkspaceSession();
  expect(useAiWorkspace.getState().nativeTabs).toEqual([]);
  expect(useComposerDrafts.getState().byTab['native-a'].text).toBe('Keep this draft');
  expect(deleteConversation).not.toHaveBeenCalled();
  useAiWorkspace.getState().openNative('native-a');
  expect(useAiWorkspace.getState().selected).toBe('chat:native-a');
});

it('reuses native navigation tabs and interleaves them with connected sessions', () => {
  useAiWorkspace.getState().openNative('native-a');
  useAiWorkspace.getState().openNative('native-a');
  expect(useAiWorkspace.getState().nativeTabs).toEqual(['native-a']);
  useAiWorkspace.getState().move(['chat:native-a', 'acp:agent-a'], 'acp:agent-a', 'chat:native-a', false);
  expect(useAiWorkspace.getState().order).toEqual(['acp:agent-a', 'chat:native-a']);
});
