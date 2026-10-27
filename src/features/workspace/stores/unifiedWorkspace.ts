import { workspaceAreaStores } from './paneWorkspace';
import { useWorkbenchStore } from './workbench';
import type { PaneTarget } from '@core/paneLayout';
import { detachWorkspacePane, mergeWorkspaceContainers } from '../services/workbench';

export const useUnifiedWorkspace = workspaceAreaStores.unified;
export const compositionTabs = () => useWorkbenchStore.getState().snapshot.tabs.filter(tab => tab.scope === 'unified');
export const selectCompositionTab = (id: string) => useUnifiedWorkspace.getState().selectTab(id);
export const detachCompositionPane = (resourceId: string) => detachWorkspacePane('unified', resourceId);
export const mergeCompositionTab = (sourceId: string, target: Omit<PaneTarget, 'rect'>) => mergeWorkspaceContainers(sourceId, useUnifiedWorkspace.getState().activeTabId, target);
