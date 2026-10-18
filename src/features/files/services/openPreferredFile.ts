import type { EditorFile } from '@core/editor';
import { useEditorPreferences } from '@config/editor';
import { useSessionStore } from '@features/workspace';

export function openPreferredFile(file: EditorFile, terminalFallback: () => void | Promise<void>) {
  const preferences = useEditorPreferences.getState();
  const mode = file.connectionId ? preferences.remoteOpenMode : preferences.localOpenMode;
  if (mode === 'editor') useSessionStore.getState().openEditorFile(file);
  else return terminalFallback();
}
