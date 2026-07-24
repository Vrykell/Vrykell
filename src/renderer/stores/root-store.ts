import { create } from 'zustand';
import { SessionInfo } from '@shared/types';
import { createSessionSlice, SessionSlice } from './slices/session-slice';
import { createRichContentSlice, RichContentSlice } from './slices/rich-content-slice';
import { createSettingsSlice, SettingsSlice } from './slices/settings-slice';
import { createAISlice, AISlice } from './slices/ai-slice';
import { createUISlice, UISlice } from './slices/ui-slice';

export interface TerminalStore
  extends SessionSlice,
    RichContentSlice,
    SettingsSlice,
    AISlice,
    UISlice {}

export const useTerminalStore = create<TerminalStore>()((...args) => {
  const session = createSessionSlice(...args);
  const richContent = createRichContentSlice(...args);
  const settings = createSettingsSlice(...args);
  const ai = createAISlice(...args);
  const ui = createUISlice(...args);

  return {
    ...session,
    ...richContent,
    ...settings,
    ...ai,
    ...ui,

    // Cross-slice coordination: initializing / dropping rich outputs when
    // sessions are added or removed keeps the original terminal-store behavior.
    addSession: (sessionInfo: SessionInfo) => {
      session.addSession(sessionInfo);
      richContent.initOutputs(sessionInfo.id);
    },

    removeSession: (id: string) => {
      session.removeSession(id);
      richContent.dropOutputs(id);
    },
  };
});
