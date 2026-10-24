import { useWorkspaceNavigation } from '../stores/navigation';
import { useUnifiedWorkspace } from '../stores/unifiedWorkspace';
import { activateWorkspaceResource, currentWorkspaceResources } from './workspaceResources';
import { selectWorkspaceArea } from './selectWorkspaceArea';

export function focusUnifiedResource(id: string) {
  const resource = currentWorkspaceResources().find(item => item.id === id);
  if (!resource || resource.kind === 'page') return;
  useUnifiedWorkspace.getState().show(id);
  activateWorkspaceResource(resource);
  useWorkspaceNavigation.getState().selectArea('unified');
}

export function openUnifiedWorkspace() {
  useUnifiedWorkspace.getState().reconcile(currentWorkspaceResources().filter(resource => resource.kind !== 'page').map(resource => resource.id));
  selectWorkspaceArea('unified');
}
