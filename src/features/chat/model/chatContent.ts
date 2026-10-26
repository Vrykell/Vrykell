import type { ChatMessage } from '../stores/chat';
import { t } from '@i18n';

export function hasChatContent(message: Pick<ChatMessage, 'content' | 'parts' | 'attachments' | 'references' | 'reasoning' | 'errorText'>): boolean {
  return !!message.content.trim() || !!message.reasoning?.trim() || !!message.errorText?.trim() || !!message.attachments?.length || !!message.references?.length
    || !!message.parts?.some(part => part.kind === 'tool' || part.kind === 'text' && !!part.text.trim());
}

export function stopChatMessage(message: ChatMessage): ChatMessage {
  return { ...message, pending: false, stopped: true, parts: message.parts?.map(part => part.kind === 'tool'
    && ['running', 'approval-pending', 'input-pending'].includes(part.tool.state)
    ? { kind: 'tool', tool: { ...part.tool, state: 'cancelled', endedAt: Date.now(), error: t(part.tool.toolName === 'ask_user' ? 'Question cancelled' : 'Stopped waiting; the terminal command may still be running') } } : part) };
}
