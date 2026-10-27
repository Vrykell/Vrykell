import type { ReactNode } from 'react';
import { t } from '@i18n';
import { tabCapabilities } from '@ui/layout/tabHandle';
import type { WorkspaceResource } from '../model/workspaceResources';
import { useWorkspaceContainerTabs } from './useWorkspaceContainerTabs';

/** Mixed tabs use the same container provider as native workspaces. */
export function useUnifiedWorkspaceTabs(resources: WorkspaceResource[], icon: (resource: WorkspaceResource) => ReactNode) {
  return useWorkspaceContainerTabs('unified', resources.map(resource => ({ id: resource.id, label: `${resource.title}${resource.dirty ? ' •' : ''}`,
    tip: resource.title, icon: icon(resource), closeLabel: t('Close this tab'), capabilities: tabCapabilities({ groupable: true, renameable: true }) })));
}
