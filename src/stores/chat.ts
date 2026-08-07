import { create } from 'zustand';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  pending?: boolean;
}

export type StreamFn = (
  messages: Array<{ role: string; content: string }>,
  onChunk: (text: string) => void,
) => Promise<void>;

let counter = 0;
const nextId = () => `m${Date.now()}-${counter++}`;

interface ChatState {
  messages: ChatMessage[];
  sending: boolean;
  send: (text: string, streamFn?: StreamFn) => Promise<void>;
  appendChunk: (id: string, chunk: string) => void;
}

let defaultStream: StreamFn = async (_msgs, onChunk) => {
  onChunk('（尚未配置 AI 服务）');
};
export function setDefaultStream(fn: StreamFn) {
  defaultStream = fn;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  sending: false,
  appendChunk: (id, chunk) =>
    set((s) => ({
      messages: s.messages.map((m) => (m.id === id ? { ...m, content: m.content + chunk } : m)),
    })),
  send: async (text, streamFn) => {
    const trimmed = text.trim();
    if (!trimmed || get().sending) return;
    const userMsg: ChatMessage = { id: nextId(), role: 'user', content: trimmed };
    const assistantMsg: ChatMessage = { id: nextId(), role: 'assistant', content: '', pending: true };
    set((s) => ({ messages: [...s.messages, userMsg, assistantMsg], sending: true }));
    const history = get()
      .messages.filter((m) => !m.pending)
      .map((m) => ({ role: m.role, content: m.content }));
    try {
      await (streamFn ?? defaultStream)(history, (chunk) => get().appendChunk(assistantMsg.id, chunk));
    } catch (err) {
      get().appendChunk(assistantMsg.id, `\n\n> 出错了：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      set((s) => ({
        sending: false,
        messages: s.messages.map((m) => (m.id === assistantMsg.id ? { ...m, pending: false } : m)),
      }));
    }
  },
}));
