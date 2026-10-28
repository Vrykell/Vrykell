import { useState } from 'react';
import { useWorkspaceResources } from '../hooks/useWorkspaceResources';
import { focusUnifiedResource } from '../services/unifiedWorkspace';
import { activateWorkspaceResource } from '../services/workspaceResources';
import { IconButton } from '@ui/actions/IconButton';
import ContextMenu, { type MenuAnchor } from '@ui/menus/ContextMenu';
import { Grid, iconSizes } from '@ui/icons';
import { t } from '@i18n';

/** Switching selects an owning tab; only an explicit split action changes its layout. */
export default function WorkspaceResourceSwitcher({ destination = 'native' }: { destination?: 'native' | 'unified' }) {
  const resources = useWorkspaceResources().filter(resource => destination !== 'unified' || resource.kind !== 'page');
  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  return <><IconButton compact className="folder-more-button workspace-resource-switch-action" aria-label={t('All workspace tabs')} data-tip={t('All workspace tabs')} aria-haspopup="menu" aria-expanded={!!menu}
    data-testid="workspace-resource-switcher" disabled={!resources.length} onClick={event => {
      const trigger = event.currentTarget; const bounds = trigger.getBoundingClientRect();
      setMenu(current => current ? null : { x: bounds.left, y: bounds.bottom + 4, trigger });
    }}><Grid size={iconSizes.control} /></IconButton>
    {menu && <ContextMenu anchor={menu} label={t('All workspace tabs')} variant="resources" itemRole="menuitem" onClose={() => setMenu(null)} items={resources.map(resource => ({
      label: resource.title, tip: resource.title, onClick: () => destination === 'unified' ? focusUnifiedResource(resource.id) : activateWorkspaceResource(resource),
    }))} />}</>;
}
