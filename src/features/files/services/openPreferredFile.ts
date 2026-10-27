import type { EditorFile } from '@core/editor';
import { editorFileKey } from '@core/editor';
import { useEditorPreferences } from '@config/editor';
import { useSessionStore } from '@features/workspace';
import { presentWorkspaceResource } from '@features/workspace/services/unifiedWorkspace';

export function openPreferredFile(file: EditorFile, terminalFallback: () => void | Promise<void>) {
  const preferences = useEditorPreferences.getState();
  const mode = file.connectionId ? preferences.remoteOpenMode : preferences.localOpenMode;
  if (mode === 'editor') {
    useSessionStore.getState().openEditorFile(file);
    presentWorkspaceResource(`file:${editorFileKey(file)}`);
  }
  else return terminalFallback();
}
