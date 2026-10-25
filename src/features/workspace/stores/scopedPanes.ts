import { createPaneWorkspaceStore } from './paneWorkspace';

export type PaneWorkspaceScope = 'code' | 'ai';
export const scopedPaneStores = {
  code: createPaneWorkspaceStore('code-pane-workspace-v1'),
  ai: createPaneWorkspaceStore('ai-pane-workspace-v1'),
};
