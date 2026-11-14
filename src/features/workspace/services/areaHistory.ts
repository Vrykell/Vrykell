import { runWithoutAreaHistory, useWorkspaceNavigation, type WorkspaceArea } from '../stores/navigation';
import { selectWorkspaceArea } from './selectWorkspaceArea';

/**
 * Re-enter a trail entry without recording it again. Activation cascades select the same
 * area through panes and remembered tabs, so the whole re-entry runs silently and the
 * forward branch the user is travelling over stays intact.
 */
function reenter(area: WorkspaceArea) {
  runWithoutAreaHistory(() => selectWorkspaceArea(area, 'all', false));
}

/** Move one step back along the visited-workspace trail. */
export function goBackWorkspaceArea(): boolean {
  const area = useWorkspaceNavigation.getState().stepAreaHistory(-1);
  if (!area) return false;
  reenter(area);
  return true;
}

/** Move one step forward along the visited-workspace trail. */
export function goForwardWorkspaceArea(): boolean {
  const area = useWorkspaceNavigation.getState().stepAreaHistory(1);
  if (!area) return false;
  reenter(area);
  return true;
}
