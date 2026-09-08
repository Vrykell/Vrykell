import { invoke } from '@tauri-apps/api/core';
import type { BackendGroupEntry } from '@/features/search/types';

export function groupsList(): Promise<BackendGroupEntry[]> {
  return invoke('groups_list');
}

export function groupCreate(id: string, title: string, timestamp: number): Promise<void> {
  return invoke('group_create', { id, title, timestamp });
}

export function groupRename(id: string, title: string): Promise<void> {
  return invoke('group_rename', { id, title });
}

export function groupSetCollapsed(id: string, collapsed: boolean): Promise<void> {
  return invoke('group_set_collapsed', { id, collapsed });
}

export function groupDelete(id: string): Promise<void> {
  return invoke('group_delete', { id });
}

export function groupDeleteWithSessions(id: string): Promise<void> {
  return invoke('group_delete_with_sessions', { id });
}

export function groupsReorder(ids: string[]): Promise<void> {
  return invoke('groups_reorder', { ids });
}

export function sessionSetGroup(sessionId: string, groupId: string | null): Promise<void> {
  return invoke('session_set_group', { sessionId, groupId });
}

export function sessionsReorder(groupId: string | null, ids: string[]): Promise<void> {
  return invoke('sessions_reorder', { groupId, ids });
}

export function groupRestore(id: string): Promise<void> {
  return invoke('group_restore', { id });
}

export function groupArchive(id: string, timestamp: number): Promise<void> {
  return invoke('group_archive', { id, timestamp });
}
