import type { EditorFile } from '@core/editor';
import { editorFileKey } from '@core/editor';
import { useEditorPreferences } from '@config/editor';
import { useSessionStore } from '@features/workspace';
import { presentWorkspaceResource } from '@features/workspace/services/unifiedWorkspace';
import { openPath } from '@tauri-apps/plugin-opener';
import { normPath } from '@platform/path';
import { fileOpsFor } from '../model/fileOps';
import { isSupportedEditorFile } from '../model/editorFileTypes';
import { useToastStore } from '@ui/feedback/Toast';
import { useFileOpenFailure } from '../stores/fileOpenFailure';
import { t } from '@i18n';

async function openInSystem(file: EditorFile): Promise<void> {
  let localPath = file.connectionId ? undefined : file.path;
  const attempt = async (): Promise<void> => {
    try {
      if (!localPath && file.connectionId) localPath = await fileOpsFor({ kind: 'ssh', connectionId: file.connectionId }).download!(file.path);
      if (!localPath) throw new Error(t('Could not download the file'));
      await openPath(normPath(localPath));
      if (file.connectionId) useToastStore.getState().addToast(t('Opened a downloaded copy. Changes are not synced to the remote file.'), 'info');
    } catch (error) {
      useFileOpenFailure.setState({ failure: { details: String((error as Error)?.message ?? error), retry: () => { void attempt(); } } });
    }
  };
  await attempt();
}

export function openPreferredFile(file: EditorFile, terminalFallback: () => void | Promise<void>) {
  const preferences = useEditorPreferences.getState();
  const mode = file.connectionId ? preferences.remoteOpenMode : preferences.localOpenMode;
  if (mode === 'editor') {
    if (!isSupportedEditorFile(file.path)) return openInSystem(file);
    useSessionStore.getState().openEditorFile(file);
    presentWorkspaceResource(`file:${editorFileKey(file)}`);
  }
  else return terminalFallback();
}
