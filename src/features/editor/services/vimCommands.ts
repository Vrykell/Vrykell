import { editorFileKey, type EditorFile, type EditorVimCommand } from '@core/editor';
import { useSessionStore } from '@features/workspace';
import { orderedWorkspaceIds } from '@features/workspace/stores/navigation';
import { useWorkbenchStore } from '@features/workspace/stores/workbench';
import { panesOf } from '@features/workspace/model/workbench';
import { useToastStore } from '@ui/feedback/Toast';
import { t } from '@i18n';
import { isDocumentDirty, useEditorDocuments } from '../stores/documents';
import { saveDocument } from './documentActions';

export async function executeEditorVimCommand(file: EditorFile, command: EditorVimCommand): Promise<boolean> {
  const fail = (message: string) => { useToastStore.getState().addToast(message, 'info'); return false; };
  if (command.args || command.ranged) return fail(t('This command does not support arguments or ranges. Use the file actions instead.'));
  const key = editorFileKey(file);
  const document = useEditorDocuments.getState().documents[key];
  if (!document || document.loading || document.saving) return fail(t('Wait for the current file operation to finish.'));
  const workspace = useSessionStore.getState();
  if (command.action === 'next' || command.action === 'previous') {
    const files = workspace.tabs.flatMap(tab => tab.kind === 'editor' ? tab.files : []);
    const ids = files.map(item => `file:${editorFileKey(item)}`);
    const savedOrder = useWorkbenchStore.getState().snapshot.tabs.filter(tab => tab.scope === 'code').flatMap(tab => panesOf(tab).map(pane => pane.resourceId));
    const order = orderedWorkspaceIds(ids, savedOrder);
    const index = order.indexOf(`file:${key}`);
    if (index < 0 || !order.length) return false;
    const next = order[(index + (command.action === 'next' ? 1 : -1) + order.length) % order.length];
    const target = files.find(item => `file:${editorFileKey(item)}` === next);
    if (target) workspace.openEditorFile(target);
    return !!target;
  }
  if (command.action === 'quit' || command.action === 'delete') {
    workspace.closeEditorFile(file, command.force); return true;
  }
  if (command.action === 'reload') {
    if (isDocumentDirty(document) && !command.force) return fail(t('Unsaved changes. Use :e! to discard them.'));
    await useEditorDocuments.getState().load(file, true, document.encoding);
    return !useEditorDocuments.getState().documents[key]?.error;
  }
  const closing = command.action === 'writeQuit' || command.action === 'exit';
  if (command.action !== 'exit' || isDocumentDirty(document)) {
    if (!await saveDocument(file, false, closing)) return false;
  }
  const current = useEditorDocuments.getState().documents[key];
  if (closing && current?.request === document.request && !isDocumentDirty(current)) workspace.closeEditorFile(file, true);
  return !closing || !!current && current.request === document.request && !isDocumentDirty(current);
}
