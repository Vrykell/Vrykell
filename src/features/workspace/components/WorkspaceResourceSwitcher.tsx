import { useState } from 'react';
import { useWorkspaceResources } from '../hooks/useWorkspaceResources';
import { activateWorkspaceResource } from '../services/workspaceResources';
import { IconButton } from '@ui/actions/IconButton';
import ContextMenu, { type MenuAnchor } from '@ui/menus/ContextMenu';
import { Grid, iconSizes } from '@ui/icons';
import { t } from '@i18n';

export default function WorkspaceResourceSwitcher() {
  const resources = useWorkspaceResources();
  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  return <><IconButton compact className="workspace-resource-switch-action" aria-label={t('All workspace tabs')} data-tip={t('All workspace tabs')} aria-haspopup="menu" aria-expanded={!!menu}
    data-testid="workspace-resource-switcher" disabled={!resources.length} onClick={event => {
      const trigger = event.currentTarget; const bounds = trigger.getBoundingClientRect();
      setMenu(current => current ? null : { x: bounds.right, y: bounds.bottom + 4, trigger, align: 'end' });
    }}><Grid size={iconSizes.control} /></IconButton>
    {menu && <ContextMenu anchor={menu} label={t('All workspace tabs')} itemRole="menuitem" onClose={() => setMenu(null)} items={resources.map(resource => ({
      label: resource.title, onClick: () => activateWorkspaceResource(resource),
    }))} />}</>;
}
