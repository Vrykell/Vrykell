import { invoke } from '@platform/diagnostics';
import type { BackendBlockEntry, BackendChatMessage, BackendSessionEntry } from '@platform/api/types';

export type { BackendChatMessage };

export function createSession(
  id: string,
  title: string,
  timestamp: number,
  cwd?: string,
  kind = 'local',
  payload = '{}',
): Promise<void> {
  return invoke('create_session', { id, title, timestamp, cwd: cwd ?? null, kind, payload });
}

export function archiveSession(id: string, timestamp: number): Promise<void> {
  return invoke('archive_session', { id, timestamp });
}

export function restoreSession(id: string): Promise<void> {
  return invoke('restore_session', { id });
}

export function updateSessionTitle(id: string, title: string): Promise<void> {
  return invoke('update_session_title', { id, title });
}

export function deleteSession(id: string): Promise<void> {
  return invoke('delete_session', { id });
}

export function updateSessionCwd(id: string, cwd: string): Promise<void> {
  return invoke('update_session_cwd', { id, cwd });
}

/** Overwrites the session payload JSON (used for split-layout persistence). */
export function updateSessionPayload(id: string, payload: string): Promise<void> {
  return invoke('update_session_payload', { id, payload });
}

export function moveTerminalPanes(sourceId: string, targetId: string, paneIds: string[]): Promise<void> {
  return invoke('move_terminal_panes', { sourceId, targetId, paneIds });
}

export function deleteTerminalPanes(sessionId: string, paneIds: string[]): Promise<void> {
  return invoke('delete_terminal_panes', { sessionId, paneIds });
}

export function getSession(id: string): Promise<BackendSessionEntry> {
  return invoke('get_session', { id });
}

/** Lists every session (active + archived), newest first. */
export function listSessions(): Promise<BackendSessionEntry[]> {
  return invoke('list_sessions');
}

// ── Block persistence ──

export function recordBlock(
  id: string, sessionId: string, paneId: string | null, command: string,
  outputRaw: string, outputClean: string, outputHtml: string, exitCode: number | null, status: string,
  startedAt: number, endedAt: number | null, cwd = '',
): Promise<void> {
  return invoke('record_block', {
    id, sessionId, paneId, command, outputRaw, outputClean, outputHtml, exitCode, status, startedAt, endedAt, cwd,
  });
}

export function getSessionBlocks(sessionId: string): Promise<BackendBlockEntry[]> {
  return invoke('get_session_blocks', { sessionId });
}

// ── AI conversation persistence ──

export function appendChatMessage(
  id: string, sessionId: string, role: string, content: string, createdAt: number, parts: string,
  attachments = '',
  paneId?: string,
): Promise<void> {
  return invoke('append_chat_message', { id, sessionId, role, content, createdAt, parts, attachments, paneId: paneId ?? null });
}

export function listChatMessages(sessionId: string): Promise<BackendChatMessage[]> {
  return invoke('list_chat_messages', { sessionId });
}

/** Deletes one AI conversation message (regenerate / edit-and-resend / delete). Idempotent. */
export function deleteChatMessage(id: string): Promise<void> {
  return invoke('delete_chat_message', { id });
}
