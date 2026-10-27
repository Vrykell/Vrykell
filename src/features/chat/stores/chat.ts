import { create } from 'zustand';
import { t } from '@i18n';
import * as conversationApi from '@platform/api/conversation';
import { safeLocalStorageGet, safeLocalStorageSet } from '@utils/errorHandler';
import { parseEnvironment, parseReferences, referenceHistoryText, type ChatEnvironment, type Conversation, type TerminalReference } from '../model/conversation';
import { useShallow } from 'zustand/react/shallow';
import { useWorkspaceStore } from '@features/workspace/stores/workspace';
import { leaves } from '@features/workspace/model/windowLayout';
import { appendChatMessage, deleteChatMessage } from '@platform/api/session';
import {
  serializeParts,
  deserializeParts,
  type MessagePart,
  type ToolRun,
} from '@features/agent/model/messageParts';
import { denyAllPending, clearSessionGrants } from '@features/agent/stores/permissions';
import { clearCompactionCache } from '@features/agent/model/context';
import { serializeAttachments, deserializeAttachments, type AttachmentMeta } from '@features/agent/model/attachments';
import { useComposerDrafts } from '@features/chat/stores/composerDrafts';
import { hasChatContent, stopChatMessage } from '../model/chatContent';
import { terminalDebug } from '@features/terminal/services/terminalDebug';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  references?: TerminalReference[];
  environment?: ChatEnvironment | null;
  stopped?: boolean;
  /**
   * Render-enhancement layer (text segments and action entries on the rail). Plain-text answers
   * keep this undefined; only upsertToolPart materializes it.
   */
  parts?: MessagePart[];
  /** Attachments sent with the message: images, files and pasted long text; persisted with it. */
  attachments?: AttachmentMeta[];
  /** Persisted pane ownership keeps split conversations distinct after restoration. */
  paneId?: string;
  /** Model reasoning stream; session memory only, never persisted. */
  reasoning?: string;
  /** Send timestamp, used to merge chat and command blocks chronologically. */
  createdAt: number;
  pending?: boolean;
  /** Stream failure marker, rendered as a synthetic error node. */
  error?: boolean;
  /** Raw failure text shown with the retry action. */
  errorText?: string;
}

/** Tool event callback: run is an upsert patch; undefined fields keep existing values. */
export interface StreamHandlers {
  onToolEvent?: (run: ToolRun) => void;
  /** Reasoning delta, appended to the answer's reasoning field. */
  onReasoning?: (chunk: string) => void;
  /** Context usage report; compaction lowers it and drives the ring component. */
  onContextUsed?: (used: number, budget: number) => void;
}

export type StreamFn = (
  messages: Array<{ role: string; content: string; attachments?: AttachmentMeta[]; parts?: MessagePart[] }>,
  onChunk: (text: string) => void,
  ctx?: { signal?: AbortSignal; tabId?: string; paneId?: string | null; environment?: ChatEnvironment | null; handlers?: StreamHandlers },
) => Promise<void>;

export interface SendOptions {
  ownerId?: string;
  conversationId?: string;
  references?: TerminalReference[];
  /** Source pane; omitted for panel-only messages that stay out of the block stream. */
  paneId?: string;
  streamFn?: StreamFn;
  /** Attachments sent with this message. */
  attachments?: AttachmentMeta[];
}

let counter = 0;
const nextId = () => `m${Date.now()}-${counter++}`;

/** In-flight streams keyed by tab; dropTab aborts them to avoid leaks. */
const abortControllers = new Map<string, AbortController>();

interface ChatState {
  queuedSends: Array<{ id: string; ownerId: string; text: string; options?: SendOptions }>;
  cancelQueuedSend: (id: string) => void;
  conversations: Conversation[];
  activeConversationId: string;
  conversationsLoaded: boolean;
  conversationsLoading: boolean;
  conversationError: string | null;
  persistenceError: string | null;
  loadConversations: () => Promise<void>;
  selectConversation: (id: string) => Promise<void>;
  ensureConversationMessages: (id: string) => Promise<void>;
  createConversation: (environment?: ChatEnvironment | null, options?: { activate?: boolean; id?: string }) => string;
  restoreDraftConversations: (drafts: readonly { id: string; title: string }[]) => void;
  setEnvironment: (id: string, environment: ChatEnvironment | null) => void;
  renameConversation: (id: string, title: string) => void;
  deleteConversation: (id: string, options?: { activateNext?: boolean }) => Promise<void>;
  retryPersistence: () => Promise<void>;
  /** Independent conversations and terminal history are keyed by their owning ID. */
  byTab: Record<string, ChatMessage[]>;
  /** Active stream owners run independently; each owner's queue remains ordered. */
  sendingTabs: string[];
  /** Context usage per tab (estimated tokens and budget); null means unknown. */
  contextUsed: Record<string, { used: number; budget: number } | null>;
  setContextUsed: (tabId: string, used: number, budget: number) => void;
  /** Composer draft; the side panel may append content such as file paths. */
  draft: string;
  draftTabId: string | null;
  setDraft: (text: string) => void;
  appendDraft: (text: string) => void;
  send: (text: string, opts?: SendOptions) => Promise<void>;
  appendChunk: (tabId: string, id: string, chunk: string) => void;
  appendReasoning: (tabId: string, id: string, chunk: string) => void;
  /** Upsert a tool action part, materializing parts lazily and keeping startedAt across patches. */
  upsertToolPart: (tabId: string, id: string, run: ToolRun) => void;
  /** Abort the in-flight stream for a tab. */
  abortStream: (tabId: string) => void;
  /** Regenerate an answer: delete the old one in memory and the database, then stream in place. */
  regenerate: (tabId: string, userMsgId: string) => Promise<void>;
  /** Delete one exchange: the question and the answer that immediately follows it. */
  deleteExchange: (tabId: string, userMsgId: string) => void;
  /** Edit and resend: restore the question to the composer and delete it and every later message. */
  editResend: (tabId: string, userMsgId: string) => void;
  /** Clear the current tab's conversation. */
  clearTab: () => void;
  /** Delete the tab's conversation when the tab closes, leaving no per-tab residue. */
  dropTab: (tabId: string) => void;
}

let defaultStream: StreamFn = async (_msgs, onChunk) => {
  onChunk(t('AI service is not configured yet'));
};
export function setDefaultStream(fn: StreamFn) {
  defaultStream = fn;
}

export const useChatStore = create<ChatState>((set, get) => {
  const drainQueue = () => {
    const index = get().queuedSends.findIndex(item => !get().sendingTabs.includes(item.ownerId));
    if (index < 0) return;
    const next = get().queuedSends[index];
    set(state => ({ queuedSends: state.queuedSends.filter(item => item.id !== next.id) }));
    void get().send(next.text, next.options).finally(() => queueMicrotask(drainQueue));
    queueMicrotask(drainQueue);
  };
  const saveQueues = new Map<string, Promise<void>>();
  const pendingMessageDeletes = new Map<string, string>();
  const pendingConversationDeletes = new Set<string>();
  const savedConversationIds = new Set<string>();
  const queueSave = (id: string, save: () => Promise<void>) => {
    const previous = saveQueues.get(id) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(save);
    saveQueues.set(id, next);
    const release = () => { if (saveQueues.get(id) === next) saveQueues.delete(id); };
    void next.then(release, (error: unknown) => {
      release(); set({ persistenceError: error instanceof Error ? error.message : String(error) });
    });
    return next;
  };
  const persistConversation = (conversation: Conversation) => {
    const messages = get().byTab[conversation.id];
    if (messages ? !messages.some(hasChatContent) : !savedConversationIds.has(conversation.id)) return Promise.resolve();
    return queueSave(conversation.id, async () => {
      await conversationApi.saveConversation(conversation.id, conversation.title, conversation.createdAt, conversation.updatedAt, JSON.stringify(conversation.environment));
      savedConversationIds.add(conversation.id);
    });
  };
  const persistMessage = (ownerId: string, message: ChatMessage) => {
    if (!hasChatContent(message)) return Promise.resolve();
    if (!get().conversations.some(conversation => conversation.id === ownerId)) {
      return import('@features/workspace/services/sessionManager').then(async manager => {
        await manager.ensureContentSession(ownerId);
        await appendChatMessage(message.id, ownerId, message.role, message.content, message.createdAt,
          serializeParts(message.parts), serializeAttachments(message.attachments), message.paneId);
      });
    }
    return queueSave(ownerId, () => conversationApi.appendConversationMessage(message.id, ownerId, message.role,
      message.content, message.createdAt, serializeParts(message.parts), serializeAttachments(message.attachments), message.paneId ?? null,
      JSON.stringify({ references: message.references ?? [], environment: message.environment ?? null,
        stopped: message.stopped ?? false, error: message.error ?? false, errorText: message.errorText ?? null })));
  };
  const deleteMessage = async (ownerId: string, messageId: string) => {
    if (!get().conversations.some(conversation => conversation.id === ownerId)) return deleteChatMessage(messageId);
    try {
      await queueSave(ownerId, async () => {
        await conversationApi.deleteConversationMessage(messageId);
        const messages = get().byTab[ownerId];
        if (messages && !messages.some(hasChatContent) && savedConversationIds.has(ownerId)) {
          await conversationApi.deleteConversation(ownerId);
          savedConversationIds.delete(ownerId);
        }
      });
      pendingMessageDeletes.delete(messageId);
    } catch (error) {
      pendingMessageDeletes.set(messageId, ownerId);
      throw error;
    }
  };
  const messageLoads = new Map<string, Promise<void>>();
  const loadMessages = async (id: string) => {
    if (id in get().byTab) return;
    const previous = messageLoads.get(id);
    if (previous) return previous;
    const pendingLoad = conversationApi.listConversationMessages(id).then(records => {
      const messages: ChatMessage[] = (records ?? []).map(record => {
        let context: { references?: unknown; environment?: unknown; stopped?: unknown; error?: unknown; errorText?: unknown } = {};
        try { context = JSON.parse(record.context || '{}') ?? {}; } catch { /* Ignore invalid optional context. */ }
        return {
          id: record.id, role: record.role === 'user' ? 'user' : 'assistant', content: record.content,
          createdAt: record.created_at, parts: deserializeParts(record.parts), attachments: deserializeAttachments(record.attachments),
          paneId: record.pane_id ?? undefined, references: parseReferences(JSON.stringify(context.references ?? [])),
          environment: parseEnvironment(JSON.stringify(context.environment ?? null)),
          stopped: context.stopped === true,
          error: context.error === true,
          errorText: typeof context.errorText === 'string' ? context.errorText : undefined,
        };
      });
      if (get().conversations.some(conversation => conversation.id === id)) {
        set(state => ({ byTab: { ...state.byTab, [id]: messages } }));
      }
    }).finally(() => messageLoads.delete(id));
    messageLoads.set(id, pendingLoad);
    return pendingLoad;
  };
  /**
   * Streaming core shared by send and regenerate: history is read from the current store state,
   * excluding pending placeholders.
   * User aborts are not failures: partial content stays, unfinished tools end in the
   * cancelled state, but the answer is not marked red and carries no error text; an
   * empty shell aborted immediately is removed.
   */
  const runAssistant = async (tabId: string, assistantId: string, controller: AbortController, streamFn?: StreamFn) => {
    const ownsTurn = () => abortControllers.get(tabId) === controller;
    if (!ownsTurn() || controller.signal.aborted) return;
    // History stops before the answer placeholder; on regeneration, later exchanges are not
    // part of this turn's context.
    const all = get().byTab[tabId] ?? [];
    const cut = all.findIndex((m) => m.id === assistantId);
    const history = (cut >= 0 ? all.slice(0, cut) : all)
      .filter((m) => !m.pending)
      .map((m) => ({
        role: m.role,
        content: m.role === 'assistant' ? m.content : m.content + referenceHistoryText(m.references),
        ...(m.role === 'assistant' && m.parts ? { parts: m.parts } : {}),
        // Pass attachments through; agentStream maps text and images according to model support.
        ...(m.attachments?.length ? { attachments: m.attachments } : {}),
      }));

    // Coalesce chunks and flush every ~50ms. Otherwise every token triggers a setState, the whole
    // message list re-renders and the streaming message re-parses all Markdown/KaTeX, which is
    // quadratic in long responses.
    let pending = '';
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      timer = null;
      if (pending && ownsTurn()) {
        get().appendChunk(tabId, assistantId, pending);
        pending = '';
      }
    };
    const onChunk = (chunk: string) => {
      if (!ownsTurn() || controller.signal.aborted) return;
      pending += chunk;
      if (timer === null) timer = setTimeout(flush, 50);
    };

    const flushOnAbort = () => { if (timer !== null) clearTimeout(timer); flush(); };
    controller.signal.addEventListener('abort', flushOnAbort, { once: true });

    let failed = false;
    let failureText = '';
    try {
      if (!controller.signal.aborted) await (streamFn ?? defaultStream)(history, onChunk, {
        signal: controller.signal,
        tabId,
        ...(get().conversations.some(conversation => conversation.id === tabId)
          ? { paneId: all[cut]?.environment?.paneId ?? null, environment: all[cut]?.environment ?? null } : {}),
        handlers: {
          // Flush buffered text before applying a tool event so text and tools keep their order.
          onToolEvent: (run) => {
            if (!ownsTurn() || controller.signal.aborted) return;
            if (timer !== null) {
              clearTimeout(timer);
              timer = null;
            }
            flush();
            get().upsertToolPart(tabId, assistantId, run);
          },
          // Append reasoning deltas to the answer; the AI panel renders them as a collapsible block.
          onReasoning: (chunk) => {
            if (!ownsTurn() || controller.signal.aborted) return;
            get().appendReasoning(tabId, assistantId, chunk);
          },
          // Context usage; compaction lowers it and drives the ring component.
          onContextUsed: (used, budget) => {
            if (!ownsTurn() || controller.signal.aborted) return;
            get().setContextUsed(tabId, used, budget);
          },
        },
      });
    } catch (err) {
      failed = !controller.signal.aborted;
      // Keep the failure text on the message; the error row renders it in an ErrorBox.
      if (failed) failureText = err instanceof Error ? err.message : String(err);
    } finally {
      controller.signal.removeEventListener('abort', flushOnAbort);
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      flush();
      if (!ownsTurn()) return;
      abortControllers.delete(tabId);
      const interrupted = failed || controller.signal.aborted;
      // Remove an immediately aborted empty answer so no blank bubble remains; a normally
      // completed empty answer keeps its placeholder because persistence expects question/answer
      // pairs.
      const cur = get().byTab[tabId]?.find((m) => m.id === assistantId);
      if (controller.signal.aborted && cur && !cur.content && !(cur.parts && cur.parts.length)) {
        set((s) => ({
          sendingTabs: s.sendingTabs.filter(id => id !== tabId),
          byTab: {
            ...s.byTab,
            [tabId]: (s.byTab[tabId] ?? []).filter((m) => m.id !== assistantId),
          },
        }));
        await deleteMessage(tabId, assistantId).catch(() => {});
        return;
      }
      set((s) => {
        if (!(tabId in s.byTab)) return { sendingTabs: s.sendingTabs.filter(id => id !== tabId) };
        return {
          sendingTabs: s.sendingTabs.filter(id => id !== tabId),
          byTab: {
            ...s.byTab,
            [tabId]: (s.byTab[tabId] ?? []).map((m) => {
              if (m.id !== assistantId) return m;
              let parts = m.parts;
              if (interrupted && parts) {
                // Stopped calls retain cancellation separately from interrupted execution failures.
                parts = parts.map((p) =>
                  p.kind === 'tool' &&
                  (p.tool.state === 'running' || p.tool.state === 'approval-pending' || p.tool.state === 'input-pending')
                    ? {
                        kind: 'tool' as const,
                        tool: {
                          ...p.tool,
                          state: controller.signal.aborted ? 'cancelled' as const : 'error' as const,
                          endedAt: p.tool.endedAt ?? Date.now(),
                          error: p.tool.error ?? t(failed ? 'Conversation interrupted' : p.tool.toolName === 'ask_user' ? 'Question cancelled' : 'Stopped waiting; the terminal command may still be running'),
                        },
                      }
                    : p,
                );
              }
              return {
                ...m,
                pending: false,
                error: failed || undefined,
                errorText: failed ? failureText : undefined,
                stopped: controller.signal.aborted || undefined,
                parts,
              };
            }),
          },
        };
      });
      queueMicrotask(drainQueue);
      // Persist the final content and render parts of the assistant message.
      const assistant = get().byTab[tabId]?.find((m) => m.id === assistantId);
      if (assistant) {
        await persistMessage(tabId, assistant).catch((e: unknown) => console.warn('[chat] Could not save answer:', e));
      }
    }
  };

  return {
  queuedSends: [], cancelQueuedSend: id => set(state => ({ queuedSends: state.queuedSends.filter(item => item.id !== id) })),
  conversations: [], activeConversationId: '', conversationsLoaded: false, conversationsLoading: false,
  conversationError: null, persistenceError: null,
  ensureConversationMessages: loadMessages,
  loadConversations: async () => {
    if (get().conversationsLoaded || get().conversationsLoading) return;
    set({ conversationsLoading: true, conversationError: null });
    try {
      const records = await conversationApi.listConversations();
      for (const record of records ?? []) savedConversationIds.add(record.id);
      const existing = get().conversations;
      const restored = (records ?? []).filter(record => !existing.some(conversation => conversation.id === record.id)).map(record => ({
        id: record.id, title: record.title.slice(0, 80) || t('New conversation'), createdAt: record.created_at,
        updatedAt: record.updated_at, environment: parseEnvironment(record.environment),
      }));
      set({ conversations: [...existing, ...restored], conversationsLoaded: true });
      const saved = safeLocalStorageGet('active-ai-conversation');
      const active = get().activeConversationId || (get().conversations.some(conversation => conversation.id === saved) ? saved : null) || get().conversations[0]?.id;
      if (active) await get().selectConversation(active);
      else get().createConversation();
    } catch (error) {
      set({ conversationError: error instanceof Error ? error.message : String(error) });
    } finally { set({ conversationsLoading: false }); }
  },
  selectConversation: async (id) => {
    if (!get().conversations.some(conversation => conversation.id === id)) return;
    set({ activeConversationId: id, conversationError: null });
    safeLocalStorageSet('active-ai-conversation', id);
    try { await loadMessages(id); }
    catch (error) { set({ conversationError: error instanceof Error ? error.message : String(error) }); }
  },
  createConversation: (environment = null, options) => {
    const id = options?.id ?? `conversation-${nextId()}`;
    if (get().conversations.some(conversation => conversation.id === id)) return id;
    const now = Date.now();
    const conversation: Conversation = { id, title: t('New conversation'), createdAt: now, updatedAt: now, environment };
    const activate = options?.activate !== false;
    set(state => ({ conversations: [conversation, ...state.conversations], ...(activate ? { activeConversationId: id } : {}), byTab: { ...state.byTab, [id]: [] }, conversationError: null }));
    if (activate) safeLocalStorageSet('active-ai-conversation', id);
    void persistConversation(conversation);
    return id;
  },
  restoreDraftConversations: drafts => set(state => {
    const known = new Set(state.conversations.map(conversation => conversation.id));
    const now = Date.now();
    const restored: Conversation[] = [];
    for (const draft of drafts) if (!known.has(draft.id)) {
      known.add(draft.id);
      restored.push({ id: draft.id, title: draft.title, createdAt: now, updatedAt: now, environment: null });
    }
    return restored.length ? { conversations: [...state.conversations, ...restored],
      byTab: { ...state.byTab, ...Object.fromEntries(restored.map(conversation => [conversation.id, []])) } } : state;
  }),
  setEnvironment: (id, environment) => {
    if (get().sendingTabs.includes(id) || pendingConversationDeletes.has(id)) return;
    const current = get().conversations.find(conversation => conversation.id === id);
    if (!current) return;
    if (current.environment?.paneId !== environment?.paneId) clearSessionGrants(id);
    const updated = { ...current, environment, updatedAt: Date.now() };
    set(state => ({ conversations: state.conversations.map(conversation => conversation.id === id ? updated : conversation) }));
    void persistConversation(updated);
  },
  renameConversation: (id, title) => {
    if (pendingConversationDeletes.has(id)) return;
    const current = get().conversations.find(conversation => conversation.id === id);
    if (!current || !title.trim()) return;
    const updated = { ...current, title: title.trim().slice(0, 80), updatedAt: Date.now() };
    set(state => ({ conversations: state.conversations.map(conversation => conversation.id === id ? updated : conversation) }));
    void persistConversation(updated);
  },
  deleteConversation: async (id, options) => {
    if (get().sendingTabs.includes(id) || pendingConversationDeletes.has(id)) return;
    pendingConversationDeletes.add(id);
    try {
      await queueSave(id, () => conversationApi.deleteConversation(id));
      set(state => ({ conversations: state.conversations.filter(conversation => conversation.id !== id) }));
      get().dropTab(id);
      if (get().activeConversationId === id) {
        if (options?.activateNext === false) { set({ activeConversationId: '' }); return; }
        const next = get().conversations[0]?.id;
        if (next) await get().selectConversation(next);
        else get().createConversation();
      }
    } catch (error) { set({ persistenceError: error instanceof Error ? error.message : String(error) }); }
    finally { pendingConversationDeletes.delete(id); }
  },
  retryPersistence: async () => {
    set({ persistenceError: null });
    for (const [messageId, ownerId] of pendingMessageDeletes) {
      if (get().conversations.some(conversation => conversation.id === ownerId)) await deleteMessage(ownerId, messageId);
      else pendingMessageDeletes.delete(messageId);
    }
    for (const conversation of get().conversations) {
      if (pendingConversationDeletes.has(conversation.id)) continue;
      await persistConversation(conversation);
      for (const message of get().byTab[conversation.id] ?? []) {
        if (!message.pending) await persistMessage(conversation.id, message);
      }
    }
  },
  byTab: {},
  sendingTabs: [],
  contextUsed: {},
  draft: '',
  draftTabId: null,
  setDraft: (text) => set({ draft: text, draftTabId: text ? useWorkspaceStore.getState().activeId : null }),
  setContextUsed: (tabId, used, budget) =>
    set((s) => ({ contextUsed: { ...s.contextUsed, [tabId]: { used, budget } } })),
  appendDraft: (text) => set((s) => {
    const tabId = useWorkspaceStore.getState().activeId;
    return { draft: s.draftTabId === tabId && s.draft ? `${s.draft} ${text}` : text, draftTabId: tabId };
  }),
  appendChunk: (tabId, id, chunk) =>
    set((s) => {
      if (!(tabId in s.byTab)) return s; // Tab closed; drop the streaming chunk.
      return {
        byTab: {
          ...s.byTab,
          [tabId]: (s.byTab[tabId] ?? []).map((m) => {
            if (m.id !== id) return m;
            const content = m.content + chunk;
            if (!m.parts) return { ...m, content };
            // Parts are materialized: append to the trailing text part, or start a new one after
            // a tool.
            const parts = m.parts.slice();
            const last = parts[parts.length - 1];
            if (last && last.kind === 'text') {
              parts[parts.length - 1] = { kind: 'text', text: last.text + chunk };
            } else {
              parts.push({ kind: 'text', text: chunk });
            }
            return { ...m, content, parts };
          }),
        },
      };
    }),
  appendReasoning: (tabId, id, chunk) =>
    set((s) => {
      if (!(tabId in s.byTab)) return s; // Tab closed; drop the reasoning stream.
      return {
        byTab: {
          ...s.byTab,
          [tabId]: (s.byTab[tabId] ?? []).map((m) =>
            m.id === id ? { ...m, reasoning: (m.reasoning ?? '') + chunk } : m,
          ),
        },
      };
    }),
  upsertToolPart: (tabId, id, run) =>
    set((s) => {
      if (!(tabId in s.byTab)) return s; // Tab closed; drop the tool event.
      return {
        byTab: {
          ...s.byTab,
          [tabId]: (s.byTab[tabId] ?? []).map((m) => {
            if (m.id !== id) return m;
            // Materialize lazily: the first tool event of a plain-text answer rebuilds the first
            // text part from the current content.
            const parts: MessagePart[] =
              m.parts ?? (m.content ? [{ kind: 'text', text: m.content }] : []);
            const idx = parts.findIndex(
              (p) => p.kind === 'tool' && p.tool.toolCallId === run.toolCallId,
            );
            if (idx < 0) return { ...m, parts: [...parts, { kind: 'tool', tool: run }] };
            const existing = parts[idx];
            if (existing.kind !== 'tool') return m;
            // Merge patch: overlay only defined fields, keeping existing values such as startedAt.
            const merged: ToolRun = { ...existing.tool };
            for (const [k, v] of Object.entries(run)) {
              if (v !== undefined) (merged as unknown as Record<string, unknown>)[k] = v;
            }
            const next = parts.slice();
            next[idx] = { kind: 'tool', tool: merged };
            return { ...m, parts: next };
          }),
        },
      };
    }),
  abortStream: (tabId) => {
    const controller = abortControllers.get(tabId);
    controller?.abort();
    abortControllers.delete(tabId);
    // Reject every pending approval so a tool execute cannot hang the turn.
    denyAllPending(tabId);
    for (const message of get().byTab[tabId] ?? []) if (message.pending && !hasChatContent(message)) void deleteMessage(tabId, message.id).catch(() => {});
    set(state => ({ sendingTabs: state.sendingTabs.filter(id => id !== tabId), queuedSends: state.queuedSends.filter(item => item.ownerId !== tabId),
      byTab: { ...state.byTab, ...(state.byTab[tabId] ? { [tabId]: state.byTab[tabId].flatMap(message => message.pending
        ? hasChatContent(message) ? [stopChatMessage(message)] : [] : [message]) } : {}) } }));
    for (const message of get().byTab[tabId] ?? []) if (message.stopped) void persistMessage(tabId, message).catch(() => {});
    terminalDebug('chat-turn-stopped', { conversationId: tabId, hadController: !!controller });
    queueMicrotask(drainQueue);
  },
  send: async (text, opts) => {
    const tabId = opts?.conversationId ?? opts?.ownerId ?? useWorkspaceStore.getState().activeId;
    const conversation = get().conversations.find(item => item.id === tabId);
    if (opts?.conversationId && (!conversation || !(tabId in get().byTab))) return;
    const trimmed = text.trim();
    const atts = opts?.attachments?.length ? opts.attachments : undefined;
    // Empty text is allowed when attachments or references exist.
    if (!trimmed && !atts && !opts?.references?.length) return;
    if (get().sendingTabs.includes(tabId)) {
      set(state => ({ queuedSends: [...state.queuedSends, { id: nextId(), ownerId: tabId, text: trimmed, options: { ...opts, ownerId: tabId, ...(conversation ? { conversationId: tabId } : {}) } }] }));
      return;
    }
    const now = Date.now();
    const environment = conversation?.environment ? { ...conversation.environment,
      cwd: useWorkspaceStore.getState().terminalCwds[conversation.environment.paneId] ?? conversation.environment.cwd } : null;
    const base = { paneId: conversation ? environment?.paneId : opts?.paneId, createdAt: now,
      ...(conversation ? { environment } : {}) };
    const userMsg: ChatMessage = { id: nextId(), role: 'user', content: trimmed, attachments: atts, references: opts?.references, ...base };
    const assistantMsg: ChatMessage = { id: nextId(), role: 'assistant', content: '', pending: true, ...base };
    const controller = new AbortController();
    abortControllers.set(tabId, controller);
    set((s) => ({
      byTab: { ...s.byTab, [tabId]: [...(s.byTab[tabId] ?? []), userMsg, assistantMsg] },
      sendingTabs: [...s.sendingTabs, tabId],
      draft: '',
      draftTabId: null,
      contextUsed: { ...s.contextUsed, [tabId]: null },
    }));
    // Persist the user message (the conversation is session state; user messages have no parts).
    if (conversation) {
      const updated = { ...conversation, environment, updatedAt: now,
        title: (get().byTab[tabId]?.filter(message => message.role === 'user').length ?? 0) === 1
          && conversation.title === t('New conversation') ? (trimmed || opts?.references?.[0]?.command || t('New conversation')).slice(0, 48) : conversation.title };
      set(state => ({ conversations: state.conversations.map(item => item.id === tabId ? updated : item) }));
      await persistConversation(updated).catch(() => {});
    } else useWorkspaceStore.getState().titleFromMessage(tabId, trimmed);
    if (conversation) await persistMessage(tabId, userMsg).catch(() => {});
    else void persistMessage(tabId, userMsg).catch(() => {});
    await runAssistant(tabId, assistantMsg.id, controller, opts?.streamFn);
  },
  regenerate: async (tabId, userMsgId) => {
    if (get().sendingTabs.includes(tabId)) return;
    const msgs = get().byTab[tabId] ?? [];
    const idx = msgs.findIndex((m) => m.id === userMsgId);
    if (idx < 0 || msgs[idx].role !== 'user') return;
    const question = msgs[idx];
    const conversation = get().conversations.find(item => item.id === tabId);
    const environment = conversation ? conversation.environment : question.environment;
    const oldAnswer = msgs[idx + 1];
    const oldAnswerId = oldAnswer?.role === 'assistant' ? oldAnswer.id : null;
    const assistantMsg: ChatMessage = {
      id: conversation && oldAnswerId ? oldAnswerId : nextId(),
      role: 'assistant',
      content: '',
      pending: true,
      paneId: conversation ? environment?.paneId : question.paneId,
      environment,
      createdAt: oldAnswer?.role === 'assistant' ? oldAnswer.createdAt : question.createdAt,
    };
    const controller = new AbortController();
    abortControllers.set(tabId, controller);
    // Replace the old answer with the new placeholder in place; history then ends at the question.
    set((s) => {
      const cur = s.byTab[tabId] ?? [];
      const i = cur.findIndex((m) => m.id === userMsgId);
      if (i < 0) return s;
      const next = cur.slice();
      if (oldAnswerId) next.splice(i + 1, 1, assistantMsg);
      else next.splice(i + 1, 0, assistantMsg);
      return { byTab: { ...s.byTab, [tabId]: next }, sendingTabs: [...s.sendingTabs, tabId] };
    });
    if (oldAnswerId && oldAnswerId !== assistantMsg.id) await deleteMessage(tabId, oldAnswerId).catch(() => {});
    if (conversation) await persistMessage(tabId, assistantMsg).catch(() => {});
    await runAssistant(tabId, assistantMsg.id, controller);
  },
  deleteExchange: (tabId, userMsgId) => {
    if (get().sendingTabs.includes(tabId)) return;
    const msgs = get().byTab[tabId] ?? [];
    const idx = msgs.findIndex((m) => m.id === userMsgId);
    if (idx < 0 || msgs[idx].role !== 'user') return;
    const ids = [userMsgId];
    const answer = msgs[idx + 1];
    if (answer?.role === 'assistant') ids.push(answer.id);
    set((s) => ({
      byTab: {
        ...s.byTab,
        [tabId]: (s.byTab[tabId] ?? []).filter((m) => !ids.includes(m.id)),
      },
    }));
    for (const id of ids) void deleteMessage(tabId, id).catch(() => {});
  },
  editResend: (tabId, userMsgId) => {
    if (get().sendingTabs.includes(tabId)) return;
    const msgs = get().byTab[tabId] ?? [];
    const idx = msgs.findIndex((m) => m.id === userMsgId);
    if (idx < 0 || msgs[idx].role !== 'user') return;
    const removed = msgs.slice(idx);
    // Restore the entire question to its session before removing the old exchange.
    useComposerDrafts.getState().setText(tabId, msgs[idx].content);
    useComposerDrafts.getState().updateAttachments(tabId, () => msgs[idx].attachments ?? []);
    if (msgs[idx].references?.length || get().conversations.some(item => item.id === tabId)) {
      useComposerDrafts.getState().setReferences(tabId, msgs[idx].references ?? []);
    }
    set((s) => ({
      byTab: { ...s.byTab, [tabId]: (s.byTab[tabId] ?? []).slice(0, idx) },
      draft: msgs[idx].content,
      draftTabId: tabId,
    }));
    for (const m of removed) void deleteMessage(tabId, m.id).catch(() => {});
  },
  clearTab: () => {
    const tabId = useWorkspaceStore.getState().activeId;
    get().abortStream(tabId);
    set((s) => ({ byTab: { ...s.byTab, [tabId]: [] } }));
  },
  dropTab: (tabId) => {
    useComposerDrafts.getState().dropTab(tabId);
    if (get().draftTabId === tabId) set({ draft: '', draftTabId: null });
    get().abortStream(tabId);
    clearCompactionCache(tabId); // Drop this tab's cached context summary.
    clearSessionGrants(tabId);
    set((s) => {
      if (!(tabId in s.byTab)) return s;
      const byTab = { ...s.byTab };
      delete byTab[tabId];
      return { byTab };
    });
  },
  };
});

/** Automated work waits for an idle workspace; interactive owners run independently. */
export function isChatTurnActive(): boolean {
  return useChatStore.getState().sendingTabs.length > 0;
}

/** Automated requests get a dedicated conversation without replacing the user's current work. */
export async function sendToChat(text: string, beforeStart?: () => Promise<void>): Promise<boolean> {
  if (!text.trim()) return false;
  const state = useChatStore.getState();
  if (state.sendingTabs.length) return false;
  const id = state.createConversation(null, { activate: false });
  if (beforeStart) {
    // Reserve this owner before recording the run, without blocking other conversations.
    useChatStore.setState(current => ({ sendingTabs: [...current.sendingTabs, id] }));
    try { await beforeStart(); }
    catch (error) {
      useChatStore.getState().abortStream(id);
      useChatStore.setState(current => {
        const byTab = { ...current.byTab }; delete byTab[id];
        return { byTab, conversations: current.conversations.filter(conversation => conversation.id !== id) };
      });
      throw error;
    }
    if (!useChatStore.getState().sendingTabs.includes(id)) return false;
    useChatStore.setState(current => ({ sendingTabs: current.sendingTabs.filter(owner => owner !== id) }));
  }
  void state.send(text.trim(), { conversationId: id });
  return true;
}

const EMPTY: ChatMessage[] = [];

/** Read the active independent conversation, regardless of terminal navigation. */
export function useActiveMessages(): ChatMessage[] {
  const activeId = useChatStore((s) => s.activeConversationId);
  return useChatStore((s) => s.byTab[activeId] ?? EMPTY);
}

/** Read the owning tab's conversation regardless of which tab is active. */
export function usePaneMessages(paneId: string): ChatMessage[] {
  const ownerId = useWorkspaceStore((state) => state.tabs.find((tab) =>
    tab.kind === 'session' && leaves(tab.layout).some((pane) => pane.id === paneId))?.id ?? state.activeId);
  return useChatStore(
    useShallow((s) => (s.byTab[ownerId] ?? EMPTY).filter((m) => m.paneId === paneId)),
  );
}

/** Context usage of the active tab, used by the ring component. */
export function useContextUsage(conversationId?: string): { used: number | null; budget: number | null } {
  const activeId = useWorkspaceStore((s) => s.activeId);
  const ctx = useChatStore((s) => s.contextUsed[conversationId ?? activeId]);
  return ctx ? { used: ctx.used, budget: ctx.budget } : { used: null, budget: null };
}
