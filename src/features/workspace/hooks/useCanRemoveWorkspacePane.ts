import { useUnifiedWorkspace } from '../stores/unifiedWorkspace';
import { workspacePaneCells } from '../model/workspaceResources';

export function useCanRemoveWorkspacePane() {
  return useUnifiedWorkspace(state => !!state.layout && workspacePaneCells(state.layout).length > 1);
}
