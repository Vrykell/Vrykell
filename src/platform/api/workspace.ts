import { invoke } from '@tauri-apps/api/core';
import type { BackendWorkspaceEntry } from '@platform/api/types';

export type { BackendWorkspaceEntry };

export function addWorkspace(path: string, name: string, timestamp: number): Promise<void> {
  return invoke('add_workspace', { path, name, timestamp });
}

export function removeWorkspace(id: number): Promise<void> {
  return invoke('remove_workspace', { id });
}

export function listWorkspaces(): Promise<BackendWorkspaceEntry[]> {
  return invoke('list_workspaces');
}
