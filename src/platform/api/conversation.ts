import { invoke } from '@platform/diagnostics';
import type { BackendChatMessage } from './types';

export interface BackendConversation {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  environment: string;
}

export interface BackendConversationMessage extends BackendChatMessage {
  context: string;
}

export const listConversations = () => invoke<BackendConversation[]>('list_conversations');
export const saveConversation = (id: string, title: string, createdAt: number, updatedAt: number, environment: string) =>
  invoke<void>('save_conversation', { id, title, createdAt, updatedAt, environment });
export const deleteConversation = (id: string) => invoke<void>('delete_conversation', { id });
export const listConversationMessages = (id: string) => invoke<BackendConversationMessage[]>('list_conversation_messages', { id });
export const deleteConversationMessage = (id: string) => invoke<void>('delete_conversation_message', { id });
export const appendConversationMessage = (id: string, conversationId: string, role: string, content: string,
  createdAt: number, parts: string, attachments: string, paneId: string | null, context: string) =>
  invoke<void>('append_conversation_message', { id, conversationId, role, content, createdAt, parts, attachments, paneId, context });
