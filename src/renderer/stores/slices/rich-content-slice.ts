import { StateCreator } from 'zustand';
import { RichOutputItem } from '@shared/types';

export interface RichContentSlice {
  richOutputs: Record<string, RichOutputItem[]>;
  appendOutput: (sessionId: string, output: RichOutputItem) => void;
  clearOutputs: (sessionId: string) => void;
  initOutputs: (sessionId: string) => void;
  dropOutputs: (sessionId: string) => void;
}

export const createRichContentSlice: StateCreator<RichContentSlice> = (set) => ({
  richOutputs: {},

  appendOutput: (sessionId, output) =>
    set((s) => ({
      richOutputs: {
        ...s.richOutputs,
        [sessionId]: [...(s.richOutputs[sessionId] || []), output],
      },
    })),

  clearOutputs: (sessionId) =>
    set((s) => ({
      richOutputs: { ...s.richOutputs, [sessionId]: [] },
    })),

  initOutputs: (sessionId) =>
    set((s) =>
      s.richOutputs[sessionId] !== undefined
        ? s
        : { richOutputs: { ...s.richOutputs, [sessionId]: [] } }
    ),

  dropOutputs: (sessionId) =>
    set((s) => {
      const { [sessionId]: _, ...rest } = s.richOutputs;
      return { richOutputs: rest };
    }),
});
