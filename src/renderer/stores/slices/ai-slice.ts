import { StateCreator } from 'zustand';
import { Message } from '../../../shared/types/index';

export interface AISlice {
  aiMessages: Message[];
  aiStreaming: boolean;
  addAIMessage: (msg: Message) => void;
  appendToLastMessage: (chunk: string) => void;
  setAIStreaming: (v: boolean) => void;
  clearAIMessages: () => void;
}

export const createAISlice: StateCreator<AISlice> = (set) => ({
  aiMessages: [],
  aiStreaming: false,

  addAIMessage: (msg) =>
    set((s) => ({ aiMessages: [...s.aiMessages, msg] })),

  appendToLastMessage: (chunk) =>
    set((s) => {
      const msgs = [...s.aiMessages];
      if (msgs.length > 0) {
        const last = msgs[msgs.length - 1];
        msgs[msgs.length - 1] = { ...last, content: last.content + chunk };
      }
      return { aiMessages: msgs };
    }),

  setAIStreaming: (v) => set({ aiStreaming: v }),

  clearAIMessages: () => set({ aiMessages: [] }),
});
