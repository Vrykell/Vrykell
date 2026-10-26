import { useMemo, type ReactNode } from 'react';
import { useWorkspaceStore, type Tab } from '../stores/workspace';
import { useUnifiedWorkspace } from '../stores/unifiedWorkspace';
import { projectUnifiedTabs } from '../model/unifiedTabHandles';
import { activateCompositionTab, closeCompositionTab } from '../services/compositionTabs';
import type { WorkspaceResource } from '../model/workspaceResources';
import type { WorkspaceTabStrip } from '../model/tabStrip';

type WorkspaceTab = Extract<Tab, { kind: 'workspace' }>;

/** Composition pages share the same handle contract as every other strip. */
export function useUnifiedWorkspaceTabs(resources: WorkspaceResource[], icon: (resource: WorkspaceResource) => ReactNode): WorkspaceTabStrip {
  const allTabs = useWorkspaceStore(state => state.tabs);
  const tabs = useMemo(() => allTabs.filter((tab): tab is WorkspaceTab => tab.kind === 'workspace'), [allTabs]);
  const handles = projectUnifiedTabs(tabs, resources, icon);
  return {
    handles,
    onSelect: id => activateCompositionTab(id),
    onClose: id => closeCompositionTab(id),
    onMove: (id, over, after) => useUnifiedWorkspace.getState().move(tabs.map(tab => tab.id), id, over, after),
  };
}
