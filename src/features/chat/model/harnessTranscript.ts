/**
 * harnessTranscript — folds an ACP `session/update` stream into the messages the transcript renders.
 *
 * The protocol streams chunks and tool states; the UI already knows how to render a flat
 * `ChatMessage[]` (the panel does exactly that), so this module only translates, never invents a
 * second transcript shape. `agent_message_chunk` appends to the answer of the current turn,
 * `tool_call`/`tool_call_update` upsert a tool row, and the tool's human-readable title travels in
 * the row's input so the existing card shows it.
 */
import type { ChatMessage } from '@features/chat';
import type { ToolRun, ToolRunState } from '@features/agent/model/messageParts';

let counter = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now()}-${counter++}`;

function textOf(content: unknown): string {
  if (!content || typeof content !== 'object') return '';
  const block = content as { type?: string; text?: string };
  return typeof block.text === 'string' ? block.text : '';
}

/** ACP tool status → the states our own tool rows use. */
function toolState(status: unknown): ToolRunState {
  switch (status) {
    case 'completed':
      return 'done';
    case 'failed':
      return 'error';
    // `pending` means "reported but not running yet"; the row is shown as working either way.
    default:
      return 'running';
  }
}

/** Tool content blocks → the plain text our rows display. */
function contentText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  const pieces: string[] = [];
  for (const entry of content) {
    if (!entry || typeof entry !== 'object') continue;
    const block = entry as { type?: string; content?: unknown; path?: string; newText?: string };
    if (block.type === 'content') pieces.push(textOf(block.content));
    else if (block.type === 'diff') pieces.push(`${block.path ?? ''}\n${block.newText ?? ''}`.trim());
    else if (block.type === 'terminal') pieces.push(`(terminal ${String((block as { terminalId?: unknown }).terminalId ?? '')})`);
  }
  return pieces.filter(Boolean).join('\n');
}

function lastMessage(messages: ChatMessage[]): ChatMessage | undefined {
  return messages[messages.length - 1];
}

function withLast(messages: ChatMessage[], update: (message: ChatMessage) => ChatMessage): ChatMessage[] {
  const head = messages.slice(0, -1);
  const tail = messages[messages.length - 1]!;
  return [...head, update(tail)];
}

/** Append text to the last text part of an assistant message (creating it when needed). */
function appendText(message: ChatMessage, text: string): ChatMessage {
  const parts = message.parts ?? (message.content ? [{ kind: 'text' as const, text: message.content }] : []);
  const last = parts[parts.length - 1];
  const nextParts = last && last.kind === 'text'
    ? [...parts.slice(0, -1), { kind: 'text' as const, text: last.text + text }]
    : [...parts, { kind: 'text' as const, text }];
  return { ...message, parts: nextParts };
}

function upsertTool(messages: ChatMessage[], run: ToolRun): ChatMessage[] {
  const index = messages.findIndex((message) =>
    message.parts?.some((part) => part.kind === 'tool' && part.tool.toolCallId === run.toolCallId));
  if (index < 0) {
    // A tool report without a message yet opens one, so the row never floats without context.
    return [...messages, {
      id: nextId('harness-assistant'), role: 'assistant', content: '', createdAt: Date.now(),
      parts: [{ kind: 'tool', tool: run }],
    }];
  }
  return messages.map((message, at) => {
    if (at !== index) return message;
    const parts = (message.parts ?? []).map((part) => {
      if (part.kind !== 'tool' || part.tool.toolCallId !== run.toolCallId) return part;
      // Only fields the update actually carries overwrite: an update that says nothing about the
      // input (or reports it as empty) must not wipe what the first report established.
      const merged: ToolRun = { ...part.tool };
      for (const [key, value] of Object.entries(run)) {
        if (value === undefined || value === '') continue;
        if (typeof value === 'object' && value !== null && Object.keys(value).length === 0) continue;
        (merged as unknown as Record<string, unknown>)[key] = value;
      }
      return { kind: 'tool' as const, tool: merged };
    });
    return { ...message, parts };
  });
}

/**
 * Fold one `session/update` payload into the transcript. Unknown variants are ignored: the protocol
 * grows, and a newer agent must not break the view.
 */
export function applyHarnessUpdate(messages: ChatMessage[], payload: Record<string, unknown>): ChatMessage[] {
  const update = (payload.update ?? {}) as Record<string, unknown>;
  const kind = update.sessionUpdate;
  switch (kind) {
    case 'user_message_chunk': {
      const text = textOf(update.content);
      const messageId = typeof update.messageId === 'string' ? update.messageId : '';
      const last = lastMessage(messages);
      if (!text) return messages;
      if (last && last.role === 'user') {
        // The agent may echo the prompt we already appended locally. Comparing text is what keeps
        // the question from appearing twice; a longer echo replaces ours instead of being appended.
        if (last.content.includes(text)) return messages;
        if (text.startsWith(last.content)) return withLast(messages, (message) => ({ ...message, content: text }));
        // A chunk of the same message (the protocol numbers them) continues it; a different message
        // starts a new bubble instead of merging two questions into one.
        if (messageId && messageId === last.id) return withLast(messages, (message) => ({ ...message, content: message.content + text }));
      }
      return [...messages, { id: messageId || nextId('harness-user'), role: 'user', content: text, createdAt: Date.now() }];
    }
    case 'agent_message_chunk': {
      const text = textOf(update.content);
      const last = lastMessage(messages);
      if (last && last.role === 'assistant') return withLast(messages, (message) => appendText(message, text));
      return [...messages, {
        id: nextId('harness-assistant'), role: 'assistant', content: '', createdAt: Date.now(),
        parts: [{ kind: 'text', text }],
      }];
    }
    case 'agent_thought_chunk': {
      const text = textOf(update.content);
      const last = lastMessage(messages);
      if (last && last.role === 'assistant') {
        return withLast(messages, (message) => ({ ...message, reasoning: (message.reasoning ?? '') + text }));
      }
      return [...messages, {
        id: nextId('harness-assistant'), role: 'assistant', content: '', createdAt: Date.now(), reasoning: text,
      }];
    }
    case 'tool_call':
    case 'tool_call_update': {
      const toolCallId = String(update.toolCallId ?? '');
      if (!toolCallId) return messages;
      const title = typeof update.title === 'string' ? update.title : '';
      const run: ToolRun = {
        toolCallId,
        // Our card falls back to the provided title for tools it does not know (the ACP case).
        toolName: typeof update.kind === 'string' ? update.kind : 'other',
        input: { ...(title ? { title } : {}), ...(update.rawInput ? { rawInput: update.rawInput } : {}) },
        state: toolState(update.status),
        startedAt: Date.now(),
      };
      const body = contentText(update.content);
      if (body) run.output = body;
      if (update.status === 'failed') run.error = body || 'the harness reported a failure';
      return upsertTool(messages, run);
    }
    default:
      return messages;
  }
}
