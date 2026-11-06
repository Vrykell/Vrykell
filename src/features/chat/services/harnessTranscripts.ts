/**
 * harnessTranscripts — the local copy of an ACP conversation.
 *
 * The agent owns its own history. This copy only keeps what the transcript displayed, so a turn
 * that was still running when the application stopped remains readable, and an agent that cannot
 * replay a session does not erase the visible conversation. Rendering still goes through the same
 * `ChatMessage[]` shape as a live session.
 */
import { deserializeParts } from '@features/agent/model/messageParts';
import { deserializeAttachments } from '@features/agent/model/attachments';
import {
  acpTranscriptDelete, acpTranscriptGet, acpTranscriptList, acpTranscriptSave,
  type AcpTranscriptSummary,
} from '@platform/api/acp';
import type { ChatMessage } from '@features/chat';

export interface RetainedHarnessTranscript {
  harness: string;
  sessionId: string;
  cwd: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  pending: boolean;
  messages: ChatMessage[];
}

const MAX_STORED_MESSAGES = 5000;

/** The title a history row shows: the first question, falling back to the agent name. */
export function harnessTranscriptTitle(messages: readonly ChatMessage[], harness: string): string {
  const first = messages.find(message => message.role === 'user' && message.content.trim());
  const text = first?.content.trim().replace(/\s+/g, ' ');
  return (text || harness).slice(0, 120);
}

/** Reasoning is explicitly session memory, never persisted; the same rule applies to this copy. */
function exportableMessage(message: ChatMessage): ChatMessage {
  const copy = { ...message };
  delete copy.reasoning;
  return copy;
}

function parseMessage(value: unknown): ChatMessage | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== 'string' || !record.id) return null;
  if (record.role !== 'user' && record.role !== 'assistant') return null;
  if (typeof record.content !== 'string') return null;
  if (typeof record.createdAt !== 'number' || !Number.isFinite(record.createdAt)) return null;
  const message: ChatMessage = {
    id: record.id,
    role: record.role,
    content: record.content,
    createdAt: record.createdAt,
  };
  if (typeof record.paneId === 'string') message.paneId = record.paneId;
  if (record.stopped === true) message.stopped = true;
  if (record.pending === true) message.pending = true;
  if (record.error === true) message.error = true;
  for (const key of ['errorText', 'errorSummary'] as const) {
    if (typeof record[key] === 'string') message[key] = record[key] as string;
  }
  if (Array.isArray(record.parts)) {
    const parts = deserializeParts(JSON.stringify(record.parts));
    if (parts) message.parts = parts;
  }
  if (Array.isArray(record.attachments)) {
    const attachments = deserializeAttachments(JSON.stringify(record.attachments));
    if (attachments) message.attachments = attachments;
  }
  return message;
}

/** Parse a stored transcript defensively: corrupt records render nothing instead of breaking a page. */
export function parseStoredMessages(raw: string): ChatMessage[] {
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.slice(0, MAX_STORED_MESSAGES).flatMap((entry) => {
      const message = parseMessage(entry);
      return message ? [message] : [];
    });
  } catch {
    return [];
  }
}

export async function saveHarnessTranscript(input: Omit<RetainedHarnessTranscript, 'messages'> & { messages: ChatMessage[] }) {
  await acpTranscriptSave({
    ...input,
    messages: JSON.stringify(input.messages.slice(0, MAX_STORED_MESSAGES).map(exportableMessage)),
  });
}

export async function loadHarnessTranscript(harness: string, sessionId: string): Promise<RetainedHarnessTranscript | null> {
  const detail = await acpTranscriptGet(harness, sessionId);
  if (!detail) return null;
  return { ...detail, messages: parseStoredMessages(detail.messages) };
}

export function listHarnessTranscripts(): Promise<AcpTranscriptSummary[]> {
  return acpTranscriptList();
}

export function deleteHarnessTranscript(harness: string, sessionId: string): Promise<void> {
  return acpTranscriptDelete(harness, sessionId);
}
