import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { useWorkspaceStore } from './workspace';
import { appendChatMessage } from '../api/session';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** 来源 pane（分屏时区分对话线；旧持久化消息没有，仅面板可见） */
  paneId?: string;
  /** 发送时间戳（块流内联时与命令块按时间归并） */
  createdAt: number;
  pending?: boolean;
  /** 流式失败标记（渲染为错误态 gutter） */
  error?: boolean;
}

export type StreamFn = (
  messages: Array<{ role: string; content: string }>,
  onChunk: (text: string) => void,
) => Promise<void>;

export interface SendOptions {
  /** 来源 pane；缺省时为 undefined（仅进面板，不进块流） */
  paneId?: string;
  streamFn?: StreamFn;
}

let counter = 0;
const nextId = () => `m${Date.now()}-${counter++}`;

interface ChatState {
  /** 按标签页隔离的对话记录 */
  byTab: Record<string, ChatMessage[]>;
  /** 正在等待 AI 回复的标签页 id */
  sendingTab: string | null;
  /** 输入框草稿（侧栏可追加内容，如文件路径） */
  draft: string;
  setDraft: (text: string) => void;
  appendDraft: (text: string) => void;
  send: (text: string, opts?: SendOptions) => Promise<void>;
  appendChunk: (tabId: string, id: string, chunk: string) => void;
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

export const useChatStore = create<ChatState>((set, get) => ({
  byTab: {},
  sendingTab: null,
  draft: '',
  setDraft: (text) => set({ draft: text }),
  appendDraft: (text) => set((s) => ({ draft: s.draft ? `${s.draft} ${text}` : text })),
  appendChunk: (tabId, id, chunk) =>
    set((s) => {
      if (!(tabId in s.byTab)) return s; // tab 已关闭，丢弃流式 chunk
      return {
        byTab: {
          ...s.byTab,
          [tabId]: (s.byTab[tabId] ?? []).map((m) =>
            m.id === id ? { ...m, content: m.content + chunk } : m,
          ),
        },
      };
    }),
  send: async (text, opts) => {
    const tabId = useWorkspaceStore.getState().activeId;
    const trimmed = text.trim();
    if (!trimmed || get().sendingTab) return;
    const now = Date.now();
    const base = { paneId: opts?.paneId, createdAt: now };
    const userMsg: ChatMessage = { id: nextId(), role: 'user', content: trimmed, ...base };
    const assistantMsg: ChatMessage = { id: nextId(), role: 'assistant', content: '', pending: true, ...base };
    set((s) => ({
      byTab: { ...s.byTab, [tabId]: [...(s.byTab[tabId] ?? []), userMsg, assistantMsg] },
      sendingTab: tabId,
      draft: '',
    }));
    // 持久化用户消息（AI 对话是会话状态的一部分）
    appendChatMessage(userMsg.id, tabId, userMsg.role, userMsg.content, now).catch(() => {});
    useWorkspaceStore.getState().titleFromMessage(tabId, trimmed);
    const history = (get().byTab[tabId] ?? [])
      .filter((m) => !m.pending)
      .map((m) => ({ role: m.role, content: m.content }));

    // 流式节流：合批 chunk，每 ~50ms flush 一次。否则每个 token 都触发一次
    // setState → 整个消息列表重渲染 → 流式消息整条 Markdown/KaTeX 重解析，
    // 长回复下是 O(n²) 的卡顿源。
    let pending = '';
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      timer = null;
      if (pending) {
        get().appendChunk(tabId, assistantMsg.id, pending);
        pending = '';
      }
    };
    const onChunk = (chunk: string) => {
      pending += chunk;
      if (timer === null) timer = setTimeout(flush, 50);
    };

    let failed = false;
    try {
      await (opts?.streamFn ?? defaultStream)(history, onChunk);
    } catch (err) {
      failed = true;
      pending += `\n\n> 出错了：${err instanceof Error ? err.message : String(err)}`;
    } finally {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      flush();
      set((s) => {
        if (!(tabId in s.byTab)) return { sendingTab: null }; // tab 已关闭，丢弃收尾写入
        return {
          sendingTab: null,
          byTab: {
            ...s.byTab,
            [tabId]: (s.byTab[tabId] ?? []).map((m) =>
              m.id === assistantMsg.id ? { ...m, pending: false, error: failed || undefined } : m,
            ),
          },
        };
      });
      // 持久化助手消息最终内容
      const assistant = get().byTab[tabId]?.find((m) => m.id === assistantMsg.id);
      if (assistant) {
        appendChatMessage(assistant.id, tabId, assistant.role, assistant.content, Date.now()).catch(() => {});
      }
    }
  },
  clearTab: () => {
    const tabId = useWorkspaceStore.getState().activeId;
    set((s) => ({ byTab: { ...s.byTab, [tabId]: [] } }));
  },
  dropTab: (tabId) =>
    set((s) => {
      if (!(tabId in s.byTab) && s.sendingTab !== tabId) return s;
      const byTab = { ...s.byTab };
      delete byTab[tabId];
      return { byTab, sendingTab: s.sendingTab === tabId ? null : s.sendingTab };
    }),
}));

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
