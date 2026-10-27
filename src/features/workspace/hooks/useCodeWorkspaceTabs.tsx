import { useMemo } from 'react';
import { editorFileKey } from '@core/editor';
import { gitComparisonKey } from '@core/git';
import { useEditorDocuments } from '@features/editor/stores/documents';
import { useWorkspaceStore } from '../stores/workspace';
import { projectCodeTabs } from '../model/codeTabHandles';
import { useWorkspaceContainerTabs } from './useWorkspaceContainerTabs';

/** Resource presentation feeds the same container provider used by every workspace. */
export function useCodeWorkspaceTabs() {
  const tabs = useWorkspaceStore(state => state.tabs);
  const activeId = useWorkspaceStore(state => state.activeId);
  const documents = useEditorDocuments(state => state.documents);
  const targets = useMemo(() => projectCodeTabs(tabs, documents), [tabs, documents]);
  const tab = tabs.find(tab => tab.id === activeId);
  const selected = tab?.kind === 'editor' ? `file:${editorFileKey(tab.selected)}` : tab?.kind === 'git-diff'
    ? `diff:${tab.comparisons?.find(item => gitComparisonKey(item.selection) === gitComparisonKey(tab.selection))?.id ?? tab.id}` : undefined;
  return useWorkspaceContainerTabs('code', targets.map(target => target.handle), selected);
}
