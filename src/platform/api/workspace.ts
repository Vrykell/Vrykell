import { invoke } from '@platform/diagnostics';
import { normPath } from '@platform/path';
import type { BackendWorkspaceEntry } from '@platform/api/types';

export type { BackendWorkspaceEntry };

/** Workspace paths are normalized at the boundary so they compare directly with file-panel entry paths. */
export function addWorkspace(path: string, name: string, timestamp: number): Promise<void> {
  return invoke('add_workspace', { path: normPath(path), name, timestamp });
}

export function removeWorkspace(id: number): Promise<void> {
  return invoke('remove_workspace', { id });
}

export function listWorkspaces(): Promise<BackendWorkspaceEntry[]> {
  return invoke<BackendWorkspaceEntry[]>('list_workspaces')
    .then((entries) => entries.map((entry) => ({ ...entry, path: normPath(entry.path) })));
}
