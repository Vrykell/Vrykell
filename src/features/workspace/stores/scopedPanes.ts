import { workspaceAreaStores } from './paneWorkspace';

export type PaneWorkspaceScope = 'code' | 'ai';
export const scopedPaneStores = {
  code: workspaceAreaStores.code,
  ai: workspaceAreaStores.ai,
};
