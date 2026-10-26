import type { ReactNode } from 'react';
import { t } from '@i18n';
import { Grid } from '@ui/icons';
import IconCountBadge from '@ui/feedback/IconCountBadge';
import { tabCapabilities, type TabHandle } from '@ui/layout/tabHandle';
import { workspacePaneCells, type WorkspaceResource } from './workspaceResources';
import type { Tab } from '../stores/workspace';

type WorkspaceTab = Extract<Tab, { kind: 'workspace' }>;

/**
 * Project composition pages into the unified strip.
 *
 * A page's label aggregates its live members until the user renames it; the handle keeps that
 * rule out of the component.
 */
export function projectUnifiedTabs(
  tabs: WorkspaceTab[],
  resources: WorkspaceResource[],
  icon: (resource: WorkspaceResource) => ReactNode,
): TabHandle[] {
  return tabs.map(tab => {
    const members = tab.paneLayout
      ? workspacePaneCells(tab.paneLayout).flatMap(cell => resources.filter(resource => resource.id === cell.resourceId))
      : [];
    const title = tab.titleSource === 'manual' ? tab.title : members.map(resource => resource.title).join(' + ') || t('Start');
    return {
      id: tab.id,
      label: `${title}${members.some(resource => resource.dirty) ? ' •' : ''}`,
      tip: title,
      closeLabel: t('Close this tab'),
      icon: <IconCountBadge count={members.length}>{members[0] ? icon(members[0]) : <Grid size={16} />}</IconCountBadge>,
      surface: members.length ? undefined : 'canvas',
      dataAttributes: { 'data-tab-kind': 'workspace' },
      capabilities: tabCapabilities({ renameable: members.length > 0 }),
    };
  });
}
