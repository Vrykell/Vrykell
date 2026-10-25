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
  partsToHistoryText,
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
   * 渲染增强层（rail 上的文本段/动作条目）。隐形契约：纯文本回答恒为
   * undefined（AiBlock 据此走 legacy 渲染），唯一物化点 = upsertToolPart。
   */
  parts?: MessagePart[];
  /** 用户消息附件（M5）：图片/文件/长文本粘贴，随消息持久化 */
  attachments?: AttachmentMeta[];
  /** Persisted pane ownership keeps split conversations distinct after restoration. */
  paneId?: string;
  /** 模型思考过程（reasoning 流）；不持久化，仅会话内存 */
  reasoning?: string;
  /** 发送时间戳（块流内联时与命令块按时间归并） */
  createdAt: number;
  pending?: boolean;
  /** 流式失败标记（渲染为合成错误节点行） */
  error?: boolean;
  /** Raw failure text shown with the retry action. */
  errorText?: string;
}

/** 工具事件回调：run 为 upsert 语义补丁（未定义字段不覆盖既有值） */
export interface StreamHandlers {
  onToolEvent?: (run: ToolRun) => void;
  /** 思考流增量（reasoning-delta）；流式追加到回答的 reasoning 字段 */
  onReasoning?: (chunk: string) => void;
  /** 上下文占用上报（压缩后自动变小，驱动圆环组件） */
  onContextUsed?: (used: number, budget: number) => void;
}

export type StreamFn = (
  messages: Array<{ role: string; content: string; attachments?: AttachmentMeta[] }>,
  onChunk: (text: string) => void,
  ctx?: { signal?: AbortSignal; tabId?: string; paneId?: string | null; environment?: ChatEnvironment | null; handlers?: StreamHandlers },
) => Promise<void>;

export interface SendOptions {
  ownerId?: string;
  conversationId?: string;
  references?: TerminalReference[];
  /** 来源 pane；缺省时为 undefined（仅进面板，不进块流） */
  paneId?: string;
  streamFn?: StreamFn;
  /** 随消息发送的附件（M5） */
  attachments?: AttachmentMeta[];
}

let counter = 0;
const nextId = () => `m${Date.now()}-${counter++}`;

/** 进行中的流式请求（tabId → AbortController），dropTab 时中止防泄漏 */
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
  createConversation: (environment?: ChatEnvironment | null, options?: { activate?: boolean }) => string;
  setEnvironment: (id: string, environment: ChatEnvironment | null) => void;
  renameConversation: (id: string, title: string) => void;
  deleteConversation: (id: string) => Promise<void>;
  retryPersistence: () => Promise<void>;
  /** Independent conversations and legacy terminal history are keyed by their owning ID. */
  byTab: Record<string, ChatMessage[]>;
  /** A single active stream owner; terminal navigation never changes this ID. */
  sendingTab: string | null;
  /** 上下文占用（tabId → 估算 token / 预算）；null=未知 */
  contextUsed: Record<string, { used: number; budget: number } | null>;
  setContextUsed: (tabId: string, used: number, budget: number) => void;
  /** 输入框草稿（侧栏可追加内容，如文件路径） */
  draft: string;
  draftTabId: string | null;
  setDraft: (text: string) => void;
  appendDraft: (text: string) => void;
  send: (text: string, opts?: SendOptions) => Promise<void>;
  appendChunk: (tabId: string, id: string, chunk: string) => void;
  appendReasoning: (tabId: string, id: string, chunk: string) => void;
  /** upsert 一个工具动作 part（惰性物化 parts；合并补丁不丢 startedAt） */
  upsertToolPart: (tabId: string, id: string, run: ToolRun) => void;
  /** 中止某 tab 进行中的流式请求（M4 停止按钮复用） */
  abortStream: (tabId: string) => void;
  /** 重新生成某条提问的回答：删旧回答（内存+DB），原地起新流（M4） */
  regenerate: (tabId: string, userMsgId: string) => Promise<void>;
  /** 删除一个交换：提问 + 紧随的回答（内存+DB）（M4） */
  deleteExchange: (tabId: string, userMsgId: string) => void;
  /** 编辑重发：提问灌回输入框草稿，删除该条及之后的全部消息（M4） */
  editResend: (tabId: string, userMsgId: string) => void;
  /** 清空当前标签页的对话 */
  clearTab: () => void;
  /** 关 tab 时删除该 tab 的对话，避免 per-tab 残留 */
  dropTab: (tabId: string) => void;
}

let defaultStream: StreamFn = async (_msgs, onChunk) => {
  onChunk('（尚未配置 AI 服务）');
};
export function setDefaultStream(fn: StreamFn) {
  defaultStream = fn;
}

export const useChatStore = create<ChatState>((set, get) => {
  const drainQueue = () => {
    if (get().sendingTab || !get().queuedSends.length) return;
    const [next, ...rest] = get().queuedSends;
    set({ queuedSends: rest });
    if (next) void get().send(next.text, next.options).finally(() => { if (!get().sendingTab) queueMicrotask(drainQueue); });
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
   * 流式内核（send/regenerate 共用）：history 取自 store 现状（排除 pending 占位）。
   * User aborts are not failures: partial content stays, unfinished tools end in the
   * error state, but the answer is not marked red and carries no error text; an
   * empty shell aborted immediately is removed.
   */
  const runAssistant = async (tabId: string, assistantId: string, controller: AbortController, streamFn?: StreamFn) => {
    const ownsTurn = () => abortControllers.get(tabId) === controller;
    if (!ownsTurn() || controller.signal.aborted) return;
    // history 截止到回答占位之前（regenerate 时其后的旧交换不参与本轮上下文）
    const all = get().byTab[tabId] ?? [];
    const cut = all.findIndex((m) => m.id === assistantId);
    const history = (cut >= 0 ? all.slice(0, cut) : all)
      .filter((m) => !m.pending)
      .map((m) => ({
        role: m.role,
        // 助手消息追加单行工具摘要，让后续轮次知道本轮做过什么
        content: m.role === 'assistant' ? m.content + partsToHistoryText(m.parts) : m.content + referenceHistoryText(m.references),
        // 附件透传：文本/图片映射由 agentStream 按模型能力展开
        ...(m.attachments?.length ? { attachments: m.attachments } : {}),
      }));

    // 流式节流：合批 chunk，每 ~50ms flush 一次。否则每个 token 都触发一次
    // setState → 整个消息列表重渲染 → 流式消息整条 Markdown/KaTeX 重解析，
    // 长回复下是 O(n²) 的卡顿源。
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
          // 工具事件直写前先把滞留文本 flush 掉，保证 text/tool 时间序
          onToolEvent: (run) => {
            if (!ownsTurn() || controller.signal.aborted) return;
            if (timer !== null) {
              clearTimeout(timer);
              timer = null;
            }
            flush();
            get().upsertToolPart(tabId, assistantId, run);
          },
          // 思考流：实时追加到回答的 reasoning 字段（AI 面板渲染为可折叠思考块）
          onReasoning: (chunk) => {
            if (!ownsTurn() || controller.signal.aborted) return;
            get().appendReasoning(tabId, assistantId, chunk);
          },
          // 上下文占用：压缩后自动变小，驱动圆环组件
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
      // 被 abort 的空壳（立即停止、什么都没生成）直接移除，不留空气泡；
      // 正常完成的空回答保留占位（向后兼容：持久化/测试都依赖问答成对）
      const cur = get().byTab[tabId]?.find((m) => m.id === assistantId);
      if (controller.signal.aborted && cur && !cur.content && !(cur.parts && cur.parts.length)) {
        set((s) => ({
          sendingTab: null,
          byTab: {
            ...s.byTab,
            [tabId]: (s.byTab[tabId] ?? []).filter((m) => m.id !== assistantId),
          },
        }));
        await deleteMessage(tabId, assistantId).catch(() => {});
        return;
      }
      set((s) => {
        if (!(tabId in s.byTab)) return { sendingTab: null }; // tab 已关闭，丢弃收尾写入
        return {
          sendingTab: null,
          byTab: {
            ...s.byTab,
            [tabId]: (s.byTab[tabId] ?? []).map((m) => {
              if (m.id !== assistantId) return m;
              let parts = m.parts;
              if (interrupted && parts) {
                // 失败/中止时，未完结的工具动作落 error 终态（节点转红）
                parts = parts.map((p) =>
                  p.kind === 'tool' &&
                  (p.tool.state === 'running' || p.tool.state === 'approval-pending' || p.tool.state === 'input-pending')
                    ? {
                        kind: 'tool' as const,
                        tool: {
                          ...p.tool,
                          state: 'error' as const,
                          endedAt: p.tool.endedAt ?? Date.now(),
                          error: p.tool.error ?? t(p.tool.toolName === 'ask_user' ? 'Question cancelled' : failed ? 'Conversation interrupted' : 'Stopped waiting; the terminal command may still be running'),
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
      // 持久化助手消息最终内容 + parts 渲染层
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
    const id = `conversation-${nextId()}`;
    const now = Date.now();
    const conversation: Conversation = { id, title: t('New conversation'), createdAt: now, updatedAt: now, environment };
    const activate = options?.activate !== false;
    set(state => ({ conversations: [conversation, ...state.conversations], ...(activate ? { activeConversationId: id } : {}), byTab: { ...state.byTab, [id]: [] }, conversationError: null }));
    if (activate) safeLocalStorageSet('active-ai-conversation', id);
    void persistConversation(conversation);
    return id;
  },
  setEnvironment: (id, environment) => {
    if (get().sendingTab === id || pendingConversationDeletes.has(id)) return;
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
  deleteConversation: async (id) => {
    if (get().sendingTab === id || pendingConversationDeletes.has(id)) return;
    pendingConversationDeletes.add(id);
    try {
      await queueSave(id, () => conversationApi.deleteConversation(id));
      set(state => ({ conversations: state.conversations.filter(conversation => conversation.id !== id) }));
      get().dropTab(id);
      if (get().activeConversationId === id) {
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
  sendingTab: null,
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
      if (!(tabId in s.byTab)) return s; // tab 已关闭，丢弃流式 chunk
      return {
        byTab: {
          ...s.byTab,
          [tabId]: (s.byTab[tabId] ?? []).map((m) => {
            if (m.id !== id) return m;
            const content = m.content + chunk;
            if (!m.parts) return { ...m, content };
            // parts 已物化：双写——chunk 追加到末尾 text part（末尾是 tool 则新开一段）
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
      if (!(tabId in s.byTab)) return s; // tab 已关闭，丢弃思考流
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
      if (!(tabId in s.byTab)) return s; // tab 已关闭，丢弃工具事件
      return {
        byTab: {
          ...s.byTab,
          [tabId]: (s.byTab[tabId] ?? []).map((m) => {
            if (m.id !== id) return m;
            // 惰性物化：纯文本回答的首个工具事件到达时，用当前 content 重建首 text part
            const parts: MessagePart[] =
              m.parts ?? (m.content ? [{ kind: 'text', text: m.content }] : []);
            const idx = parts.findIndex(
              (p) => p.kind === 'tool' && p.tool.toolCallId === run.toolCallId,
            );
            if (idx < 0) return { ...m, parts: [...parts, { kind: 'tool', tool: run }] };
            const existing = parts[idx];
            if (existing.kind !== 'tool') return m;
            // 合并补丁：仅覆盖定义了的字段（保住 startedAt 等既有值）
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
    // M3：挂起的审批 Promise 一律按拒绝放行，防工具 execute 悬挂卡死步进
    denyAllPending(tabId);
    for (const message of get().byTab[tabId] ?? []) if (message.pending && !hasChatContent(message)) void deleteMessage(tabId, message.id).catch(() => {});
    set(state => ({ sendingTab: state.sendingTab === tabId ? null : state.sendingTab, queuedSends: state.queuedSends.filter(item => item.ownerId !== tabId),
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
    // 空文本但有附件也允许发送（「看看这张图」之外的纯附件场景）
    if (!trimmed && !atts && !opts?.references?.length) return;
    if (get().sendingTab) {
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
      sendingTab: tabId,
      draft: '',
      draftTabId: null,
      contextUsed: { ...s.contextUsed, [tabId]: null },
    }));
    // 持久化用户消息（AI 对话是会话状态的一部分；用户消息无 parts）
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
    if (get().sendingTab) return;
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
    // 新回答占位替换旧回答（原地），history 随之 = 到该提问为止
    set((s) => {
      const cur = s.byTab[tabId] ?? [];
      const i = cur.findIndex((m) => m.id === userMsgId);
      if (i < 0) return s;
      const next = cur.slice();
      if (oldAnswerId) next.splice(i + 1, 1, assistantMsg);
      else next.splice(i + 1, 0, assistantMsg);
      return { byTab: { ...s.byTab, [tabId]: next }, sendingTab: tabId };
    });
    if (oldAnswerId && oldAnswerId !== assistantMsg.id) await deleteMessage(tabId, oldAnswerId).catch(() => {});
    if (conversation) await persistMessage(tabId, assistantMsg).catch(() => {});
    await runAssistant(tabId, assistantMsg.id, controller);
  },
  deleteExchange: (tabId, userMsgId) => {
    if (get().sendingTab) return;
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
    if (get().sendingTab) return;
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
    if (get().sendingTab === tabId) denyAllPending(tabId);
    clearCompactionCache(tabId); // 清理该 tab 的上下文摘要缓存
    clearSessionGrants(tabId);
    set((s) => {
      if (!(tabId in s.byTab) && s.sendingTab !== tabId) return s;
      const byTab = { ...s.byTab };
      delete byTab[tabId];
      return { byTab, sendingTab: s.sendingTab === tabId ? null : s.sendingTab };
    });
  },
  };
});

/** True while a turn is in flight: the store runs one turn at a time across all conversations. */
export function isChatTurnActive(): boolean {
  return useChatStore.getState().sendingTab !== null;
}

/** Automated requests get a dedicated conversation without replacing the user's current work. */
export function sendToChat(text: string) {
  if (!text.trim()) return;
  const state = useChatStore.getState();
  if (state.sendingTab) return;
  const id = state.createConversation(null, { activate: false });
  void state.send(text.trim(), { conversationId: id });
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

/** 当前活跃标签页的上下文占用（圆环组件用）。 */
export function useContextUsage(conversationId?: string): { used: number | null; budget: number | null } {
  const activeId = useWorkspaceStore((s) => s.activeId);
  const ctx = useChatStore((s) => s.contextUsed[conversationId ?? activeId]);
  return ctx ? { used: ctx.used, budget: ctx.budget } : { used: null, budget: null };
}
