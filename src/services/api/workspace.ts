import { invoke } from '@tauri-apps/api/core';

export interface BackendWorkspaceEntry {
  id: number;
  path: string;
  name: string;
  added_at: number;
}

export function addWorkspace(path: string, name: string, timestamp: number): Promise<void> {
  return invoke('add_workspace', { path, name, timestamp });
}

export function removeWorkspace(id: number): Promise<void> {
  return invoke('remove_workspace', { id });
}

export function listWorkspaces(): Promise<BackendWorkspaceEntry[]> {
  return invoke('list_workspaces');
}
