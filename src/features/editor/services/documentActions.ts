import { editorFileKey, type EditorFile } from '@core/editor';
import { t } from '@i18n';
import { pickPath } from '@platform/api/fs';
import { useSessionStore } from '@features/workspace';
import { rebindWorkspaceResourceId, runWithoutWorkbenchSync } from '@features/workspace/services/workbench';
import { useToastStore } from '@ui/feedback/Toast';
import { useEditorDocuments } from '../stores/documents';
const pendingDestinations = new Set<string>();

export function newEditorFile() {
  const used = new Set(useSessionStore.getState().tabs.flatMap(tab => tab.kind === 'editor' ? tab.files.map(file => file.path) : []));
  let number = 1;
  while (used.has(t('Untitled {{number}}', { number }) + '.txt')) number += 1;
  const file = { path: t('Untitled {{number}}', { number }) + '.txt', draftId: crypto.randomUUID() };
  void useEditorDocuments.getState().load(file);
  useSessionStore.getState().openEditorFile(file);
}

export async function saveDocument(file: EditorFile, saveAs = false, closing = false): Promise<boolean> {
  if (!file.draftId && !saveAs) return useEditorDocuments.getState().save(file);
  const key = editorFileKey(file);
  if (pendingDestinations.has(key)) return false;
  pendingDestinations.add(key);
  try {
    const [path] = await pickPath('save', { fileName: file.path.split(/[\\/]/).pop() });
    if (!path) return false;
    const target = { path };
    if (editorFileKey(target) === editorFileKey(file)) return useEditorDocuments.getState().save(file);
    const saved = await useEditorDocuments.getState().saveAs(file, target, closing);
    if (saved && !closing) {
      // Rebind the placement before the native tab changes, so the draft's pane is not pruned.
      const previousId = `file:${editorFileKey(file)}`; const nextId = `file:${editorFileKey(target)}`;
      runWithoutWorkbenchSync(() => {
        rebindWorkspaceResourceId(previousId, nextId);
        useSessionStore.getState().replaceEditorFile(file, target);
      });
    }
    return saved;
  } catch (reason) {
    useToastStore.getState().addToast(t('Could not save file: {{error}}', { error: String(reason) }), 'error');
    return false;
  } finally { pendingDestinations.delete(key); }
}
