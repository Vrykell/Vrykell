import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { type AttachmentMeta, serializeAttachments } from '../agent/attachments';
import { clearCompactionCache } from '../agent/context';
import {
  type MessagePart,
  partsToHistoryText,
  serializeParts,
  type ToolRun,
} from '../agent/messageParts';
import { denyAllPending } from '../agent/permissions';
import { appendChatMessage, deleteChatMessage } from '../api/session';
import { useWorkspaceStore } from './workspace';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /**
   * 渲染增强层（rail 上的文本段/动作条目）。隐形契约：纯文本回答恒为
   * undefined（AiBlock 据此走 legacy 渲染），唯一物化点 = upsertToolPart。
   */
  parts?: MessagePart[];
  /** 用户消息附件（M5）：图片/文件/长文本粘贴，随消息持久化 */
  attachments?: AttachmentMeta[];
  /** 来源 pane（分屏时区分对话线；旧持久化消息没有，仅面板可见） */
  paneId?: string;
  /** 模型思考过程（reasoning 流）；不持久化，仅会话内存 */
  reasoning?: string;
  /** 发送时间戳（块流内联时与命令块按时间归并） */
  createdAt: number;
  pending?: boolean;
  /** 流式失败标记（渲染为合成错误节点行） */
  error?: boolean;
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
  ctx?: { signal?: AbortSignal; tabId?: string; handlers?: StreamHandlers },
) => Promise<void>;

export interface SendOptions {
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
  /** 按标签页隔离的对话记录 */
  byTab: Record<string, ChatMessage[]>;
  /** 正在等待 AI 回复的标签页 id */
  sendingTab: string | null;
  /** 上下文占用（tabId → 估算 token / 预算）；null=未知 */
  contextUsed: Record<string, { used: number; budget: number } | null>;
  setContextUsed: (tabId: string, used: number, budget: number) => void;
  /** 输入框草稿（侧栏可追加内容，如文件路径） */
  draft: string;
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
  /**
   * 流式内核（send/regenerate 共用）：history 取自 store 现状（排除 pending 占位）。
   * 用户主动 abort 不算错误：保留已生成的部分内容、未完结工具落 error 终态，
   * 但整条回答不标红、不追加「出错了」文本；立即停止的空壳回答直接移除。
   */
  const runAssistant = async (tabId: string, assistantId: string, streamFn?: StreamFn) => {
    // history 截止到回答占位之前（regenerate 时其后的旧交换不参与本轮上下文）
    const all = get().byTab[tabId] ?? [];
    const cut = all.findIndex((m) => m.id === assistantId);
    const history = (cut >= 0 ? all.slice(0, cut) : all)
      .filter((m) => !m.pending)
      .map((m) => ({
        role: m.role,
        // 助手消息追加单行工具摘要，让后续轮次知道本轮做过什么
        content: m.role === 'assistant' ? m.content + partsToHistoryText(m.parts) : m.content,
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
      if (pending) {
        get().appendChunk(tabId, assistantId, pending);
        pending = '';
      }
    };
    const onChunk = (chunk: string) => {
      pending += chunk;
      if (timer === null) timer = setTimeout(flush, 50);
    };

    const controller = new AbortController();
    abortControllers.set(tabId, controller);

    let failed = false;
    try {
      await (streamFn ?? defaultStream)(history, onChunk, {
        signal: controller.signal,
        tabId,
        handlers: {
          // 工具事件直写前先把滞留文本 flush 掉，保证 text/tool 时间序
          onToolEvent: (run) => {
            if (timer !== null) {
              clearTimeout(timer);
              timer = null;
            }
            flush();
            get().upsertToolPart(tabId, assistantId, run);
          },
          // 思考流：实时追加到回答的 reasoning 字段（AI 面板渲染为可折叠思考块）
          onReasoning: (chunk) => {
            get().appendReasoning(tabId, assistantId, chunk);
          },
          // 上下文占用：压缩后自动变小，驱动圆环组件
          onContextUsed: (used, budget) => {
            get().setContextUsed(tabId, used, budget);
          },
        },
      });
    } catch (err) {
      failed = !controller.signal.aborted;
      if (failed) pending += `\n\n> 出错了：${err instanceof Error ? err.message : String(err)}`;
    } finally {
      // finally 只做清理（无论成功/失败/中止都要执行）；业务收尾放在 try/finally 之后，
      // 避免 finally 中 return 改写控制流
      abortControllers.delete(tabId);
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      flush();
    }

    const interrupted = failed || controller.signal.aborted;
    // 被 abort 的空壳（立即停止、什么都没生成）直接移除，不留空气泡；
    // 正常完成的空回答保留占位（向后兼容：持久化/测试都依赖问答成对）
    const cur = get().byTab[tabId]?.find((m) => m.id === assistantId);
    const emptyAborted = controller.signal.aborted && !!cur && !cur.content && !cur.parts?.length;
    if (emptyAborted) {
      set((s) => ({
        sendingTab: null,
        byTab: {
          ...s.byTab,
          [tabId]: (s.byTab[tabId] ?? []).filter((m) => m.id !== assistantId),
        },
      }));
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
                (p.tool.state === 'running' || p.tool.state === 'approval-pending')
                  ? {
                      kind: 'tool' as const,
                      tool: {
                        ...p.tool,
                        state: 'error' as const,
                        endedAt: p.tool.endedAt ?? Date.now(),
                        error: p.tool.error ?? (failed ? '对话中断' : '已停止'),
                      },
                    }
                  : p,
              );
            }
            return { ...m, pending: false, error: failed || undefined, parts };
          }),
        },
      };
    });
    // 持久化助手消息最终内容 + parts 渲染层
    const assistant = get().byTab[tabId]?.find((m) => m.id === assistantId);
    if (assistant) {
      appendChatMessage(
        assistant.id,
        tabId,
        assistant.role,
        assistant.content,
        Date.now(),
        serializeParts(assistant.parts),
      ).catch((e) => console.warn('[chat] 助手消息持久化失败（重启后该轮对话可能丢失）:', e));
    }
  };

  return {
    byTab: {},
    sendingTab: null,
    contextUsed: {},
    draft: '',
    setDraft: (text) => set({ draft: text }),
    setContextUsed: (tabId, used, budget) =>
      set((s) => ({ contextUsed: { ...s.contextUsed, [tabId]: { used, budget } } })),
    appendDraft: (text) => set((s) => ({ draft: s.draft ? `${s.draft} ${text}` : text })),
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
      abortControllers.get(tabId)?.abort();
      // M3：挂起的审批 Promise 一律按拒绝放行，防工具 execute 悬挂卡死步进
      denyAllPending();
    },
    send: async (text, opts) => {
      const tabId = useWorkspaceStore.getState().activeId;
      const trimmed = text.trim();
      const atts = opts?.attachments?.length ? opts.attachments : undefined;
      // 空文本但有附件也允许发送（「看看这张图」之外的纯附件场景）
      if ((!trimmed && !atts) || get().sendingTab) return;
      const now = Date.now();
      const base = { paneId: opts?.paneId, createdAt: now };
      const userMsg: ChatMessage = {
        id: nextId(),
        role: 'user',
        content: trimmed,
        attachments: atts,
        ...base,
      };
      const assistantMsg: ChatMessage = {
        id: nextId(),
        role: 'assistant',
        content: '',
        pending: true,
        ...base,
      };
      set((s) => ({
        byTab: { ...s.byTab, [tabId]: [...(s.byTab[tabId] ?? []), userMsg, assistantMsg] },
        sendingTab: tabId,
        draft: '',
        contextUsed: { ...s.contextUsed, [tabId]: null },
      }));
      // 持久化用户消息（AI 对话是会话状态的一部分；用户消息无 parts）
      appendChatMessage(
        userMsg.id,
        tabId,
        userMsg.role,
        userMsg.content,
        now,
        '',
        serializeAttachments(atts),
      ).catch(() => {});
      useWorkspaceStore.getState().titleFromMessage(tabId, trimmed);
      await runAssistant(tabId, assistantMsg.id, opts?.streamFn);
    },
    regenerate: async (tabId, userMsgId) => {
      if (get().sendingTab) return;
      const msgs = get().byTab[tabId] ?? [];
      const idx = msgs.findIndex((m) => m.id === userMsgId);
      if (idx < 0 || msgs[idx].role !== 'user') return;
      const question = msgs[idx];
      const oldAnswer = msgs[idx + 1];
      const oldAnswerId = oldAnswer?.role === 'assistant' ? oldAnswer.id : null;
      const assistantMsg: ChatMessage = {
        id: nextId(),
        role: 'assistant',
        content: '',
        pending: true,
        paneId: question.paneId,
        createdAt: Date.now(),
      };
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
      if (oldAnswerId) deleteChatMessage(oldAnswerId).catch(() => {});
      await runAssistant(tabId, assistantMsg.id);
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
      for (const id of ids) deleteChatMessage(id).catch(() => {});
    },
    editResend: (tabId, userMsgId) => {
      if (get().sendingTab) return;
      const msgs = get().byTab[tabId] ?? [];
      const idx = msgs.findIndex((m) => m.id === userMsgId);
      if (idx < 0 || msgs[idx].role !== 'user') return;
      const removed = msgs.slice(idx);
      // 该条及之后全部删除；提问内容灌回草稿（PanelChat 订阅 draft 灌入输入框）
      set((s) => ({
        byTab: { ...s.byTab, [tabId]: (s.byTab[tabId] ?? []).slice(0, idx) },
        draft: msgs[idx].content,
      }));
      for (const m of removed) deleteChatMessage(m.id).catch(() => {});
    },
    clearTab: () => {
      const tabId = useWorkspaceStore.getState().activeId;
      set((s) => ({ byTab: { ...s.byTab, [tabId]: [] } }));
    },
    dropTab: (tabId) => {
      abortControllers.get(tabId)?.abort();
      abortControllers.delete(tabId);
      denyAllPending(); // 同 abortStream：防审批悬挂
      clearCompactionCache(tabId); // 清理该 tab 的上下文摘要缓存
      set((s) => {
        if (!(tabId in s.byTab) && s.sendingTab !== tabId) return s;
        const byTab = { ...s.byTab };
        delete byTab[tabId];
        return { byTab, sendingTab: s.sendingTab === tabId ? null : s.sendingTab };
      });
    },
  };
});

/** 统一接口：将文本发往 AI 对话框（新增消息，不覆盖已有） */
export function sendToChat(text: string) {
  if (!text.trim()) return;
  useChatStore.getState().send(text.trim());
}

const EMPTY: ChatMessage[] = [];

/** 读取当前活跃标签页的消息（组件用） */
export function useActiveMessages(): ChatMessage[] {
  const activeId = useWorkspaceStore((s) => s.activeId);
  return useChatStore((s) => s.byTab[activeId] ?? EMPTY);
}

/**
 * 读取某个 pane 的对话线（块流内联用）。
 * 无 paneId 的 tab 级旧消息不进块流，只在面板可见。
 */
export function usePaneMessages(paneId: string): ChatMessage[] {
  const activeId = useWorkspaceStore((s) => s.activeId);
  return useChatStore(
    useShallow((s) => (s.byTab[activeId] ?? EMPTY).filter((m) => m.paneId === paneId)),
  );
}

/** 当前活跃标签页的上下文占用（圆环组件用）。 */
export function useContextUsage(): { used: number | null; budget: number | null } {
  const activeId = useWorkspaceStore((s) => s.activeId);
  const ctx = useChatStore((s) => s.contextUsed[activeId]);
  return ctx ? { used: ctx.used, budget: ctx.budget } : { used: null, budget: null };
}
