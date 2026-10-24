import { editorFileKey } from '@core/editor';
import { t } from '@i18n';
import { fileIcon } from '@features/files';
import { isDocumentDirty, useEditorDocuments } from '@features/editor/stores/documents';
import { useSessionStore } from '@features/workspace';
import type { FolderTab } from '@ui/layout/FolderTabs';
import { iconSizes } from '@ui/icons';
import { orderedWorkspaceIds, useWorkspaceNavigation } from '../stores/navigation';

/** Files and comparisons share ordering while retaining their original close guards. */
export function useCodeWorkspaceTabs() {
  const tabs = useSessionStore(state => state.tabs);
  const documents = useEditorDocuments(state => state.documents);
  const order = useWorkspaceNavigation(state => state.codeOrder);
  const entries = tabs.flatMap(tab => {
    if (tab.kind === 'editor') return tab.files.map(file => {
      const Icon = fileIcon(file.path);
      return { id: `file:${editorFileKey(file)}`, label: `${file.path.split(/[\\/]/).pop()}${isDocumentDirty(documents[editorFileKey(file)]) ? ' •' : ''}`,
        tip: file.path, icon: <Icon size={iconSizes.compact} />, closeLabel: t('Close file {{path}}', { path: file.path }),
        select: () => useSessionStore.getState().openEditorFile(file), close: () => useSessionStore.getState().closeEditorFile(file) };
    });
    if (tab.kind === 'git-diff') return (tab.comparisons ?? [{ id: tab.id, selection: tab.selection }]).map(item => {
      const Icon = fileIcon(item.selection.path);
      return { id: `diff:${item.id}`, label: `${item.selection.path.split(/[\\/]/).pop()} · ${t(item.selection.scope === 'staged' ? 'Staged changes' : 'File comparison')}`,
        tip: `${item.selection.target.cwd}/${item.selection.path}`, icon: <Icon size={iconSizes.compact} />, closeLabel: t('Close comparison {{path}}', { path: item.selection.path }),
        select: () => useSessionStore.getState().activateGitComparison(item.id), close: () => useSessionStore.getState().closeGitComparison(item.id) };
    });
    return [];
  });
  const ids = entries.map(item => item.id);
  const items: FolderTab[] = orderedWorkspaceIds(ids, order).map(id => entries.find(item => item.id === id)!);
  return { items,
    onSelect: (id: string) => entries.find(item => item.id === id)?.select(),
    onClose: (id: string) => entries.find(item => item.id === id)?.close(),
    onMove: (id: string, over: string, after: boolean) => useWorkspaceNavigation.getState().moveCodeTab(ids, id, over, after),
  };
}
