import { useMemo } from 'react';
import { useEditorDocuments } from '@features/editor/stores/documents';
import { useSessionStore } from '@features/workspace';
import { useWorkspaceNavigation } from '../stores/navigation';
import { projectCodeTabs } from '../model/codeTabHandles';
import type { WorkspaceTabStrip } from '../model/tabStrip';

/** Files and comparisons share ordering while retaining their original close guards. */
export function useCodeWorkspaceTabs(): WorkspaceTabStrip {
  const tabs = useSessionStore(state => state.tabs);
  const documents = useEditorDocuments(state => state.documents);
  const order = useWorkspaceNavigation(state => state.codeOrder);
  const targets = useMemo(() => projectCodeTabs(tabs, documents, order), [tabs, documents, order]);
  const target = (id: string) => targets.find(item => item.handle.id === id);
  return {
    handles: targets.map(item => item.handle),
    onSelect: id => {
      const item = target(id);
      if (!item) return;
      if ('file' in item) useSessionStore.getState().openEditorFile(item.file);
      else useSessionStore.getState().activateGitComparison(item.comparisonId);
    },
    onClose: id => {
      const item = target(id);
      if (!item) return;
      if ('file' in item) useSessionStore.getState().closeEditorFile(item.file);
      else useSessionStore.getState().closeGitComparison(item.comparisonId);
    },
    onMove: (id, over, after) => useWorkspaceNavigation.getState()
      .moveCodeTab(targets.map(item => item.handle.id), id, over, after),
  };
}
