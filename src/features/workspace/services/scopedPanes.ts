import { newEditorFile } from '@features/editor/services/documentActions';
import { useAiWorkspace } from '@features/chat/stores/aiWorkspace';
import { useChatStore } from '@features/chat/stores/chat';
import { useHarnessWorkspace } from '@features/chat/stores/harnessWorkspace';
import { useWorkspaceStore } from '../stores/workspace';
import { currentWorkspaceResources } from './workspaceResources';
import { editorFileKey, type EditorFile } from '@core/editor';

export function createScopedResource(addition: { create: 'document' | 'conversation' } | { harness: string; cwd?: string } | { file: EditorFile }) {
  if ('file' in addition) { useWorkspaceStore.getState().openEditorFile(addition.file); return `file:${editorFileKey(addition.file)}`; }
  if ('harness' in addition) return `acp:${useHarnessWorkspace.getState().connect(addition.harness, addition.cwd, true)}`;
  const before = new Set(currentWorkspaceResources().map(resource => resource.id));
  if (addition.create === 'document') newEditorFile();
  else { useAiWorkspace.getState().openNative(useChatStore.getState().createConversation()); useWorkspaceStore.getState().openHarnessTab(); }
  return currentWorkspaceResources().find(resource => !before.has(resource.id))?.id;
}
