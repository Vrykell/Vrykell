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

/** 覆盖会话 payload JSON（分屏布局持久化用）。 */
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

/** 列出全部会话（活跃 + 历史），按创建时间倒序。 */
export function listSessions(): Promise<BackendSessionEntry[]> {
  return invoke('list_sessions');
}

// ── 块持久化 ──

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

// ── AI 对话持久化 ──

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

/** 删除单条 AI 对话消息（M4：重新生成/编辑重发/删除交换）。幂等。 */
export function deleteChatMessage(id: string): Promise<void> {
  return invoke('delete_chat_message', { id });
}
