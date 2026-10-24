import { useWorkspaceStore } from '../stores/workspace';
import { useAiWorkspace } from '@features/chat/stores/aiWorkspace';
import { useChatStore } from '@features/chat/stores/chat';
import { useHarnessWorkspace } from '@features/chat/stores/harnessWorkspace';
import { workspaceResources } from '../model/workspaceResources';
import { editorFileKey } from '@core/editor';
import { isDocumentDirty, useEditorDocuments } from '@features/editor/stores/documents';

export function useWorkspaceResources() {
  const tabs = useWorkspaceStore(state => state.tabs);
  const nativeIds = useAiWorkspace(state => state.nativeTabs);
  const conversations = useChatStore(state => state.conversations);
  const agents = useHarnessWorkspace(state => state.connections);
  const documents = useEditorDocuments(state => state.documents);
  return workspaceResources(tabs, nativeIds, conversations, agents).map(resource => resource.kind === 'document'
    ? { ...resource, dirty: isDocumentDirty(documents[editorFileKey(resource.file)]) } : resource);
}
