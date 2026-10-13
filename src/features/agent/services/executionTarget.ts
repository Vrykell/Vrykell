import { useSessionStore } from '@features/workspace';
import { leaves } from '@features/workspace/model/windowLayout';

/** Resolve the captured target independently of the workspace's current focus. */
export function executionPaneSpec(paneId: string | null | undefined) {
  return useSessionStore.getState().tabs
    .flatMap(tab => tab.kind === 'session' ? leaves(tab.layout) : [])
    .find(pane => pane.id === paneId);
}
