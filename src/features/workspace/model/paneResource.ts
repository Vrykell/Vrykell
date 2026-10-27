import type { WorkspaceHistoryMember } from './workspaceHistory';
import type { WorkspaceResource } from './workspaceResources';

/** Domain adapters implement behavior; containers hold only durable resource references. */
export interface PaneResource {
  resource: WorkspaceResource;
  capabilities: Readonly<{ split: boolean; rename: boolean; persist: boolean }>;
  activate: () => void;
  requestClose: (force?: boolean) => void;
  delete: () => Promise<void>;
  serialize: () => WorkspaceHistoryMember | null;
}
