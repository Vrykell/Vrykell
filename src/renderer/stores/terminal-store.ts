import { create } from 'zustand';
import { SessionInfo, RichOutputItem, Message, AppSettings, DEFAULT_SETTINGS } from '../../shared/types';

interface TerminalStore {
  // Sessions
  sessions: SessionInfo[];
  activeSessionId: string | null;

  // Rich outputs (keyed by sessionId)
  richOutputs: Record<string, RichOutputItem[]>;

  // Settings
  settings: AppSettings;

  // AI
  aiMessages: Message[];
  aiStreaming: boolean;

  // UI
  sidebarOpen: boolean;
  outputPanelHeight: number;

  // Actions
  addSession: (session: SessionInfo) => void;
  removeSession: (id: string) => void;
  setActive: (id: string) => void;
  updateSessionTitle: (id: string, title: string) => void;

  appendOutput: (sessionId: string, output: RichOutputItem) => void;
  clearOutputs: (sessionId: string) => void;

  addAIMessage: (msg: Message) => void;
  setAIStreaming: (v: boolean) => void;
  clearAIMessages: () => void;

  updateSettings: (partial: Partial<AppSettings>) => void;

  toggleSidebar: () => void;
  setOutputPanelHeight: (h: number) => void;
}

export const useTerminalStore = create<TerminalStore>((set) => ({
  sessions: [],
  activeSessionId: null,
  richOutputs: {},
  settings: DEFAULT_SETTINGS,
  aiMessages: [],
  aiStreaming: false,
  sidebarOpen: false,
  outputPanelHeight: 200,

  addSession: (session) =>
    set((s) => ({
      sessions: [...s.sessions, session],
      activeSessionId: s.activeSessionId || session.id,
      richOutputs: { ...s.richOutputs, [session.id]: [] },
    })),

  removeSession: (id) =>
    set((s) => {
      const sessions = s.sessions.filter((ses) => ses.id !== id);
      const { [id]: _, ...richOutputs } = s.richOutputs;
      return {
        sessions,
        richOutputs,
        activeSessionId: s.activeSessionId === id ? sessions[0]?.id || null : s.activeSessionId,
      };
    }),

  setActive: (id) => set({ activeSessionId: id }),

  updateSessionTitle: (id, title) =>
    set((s) => ({
      sessions: s.sessions.map((ses) => (ses.id === id ? { ...ses, title } : ses)),
    })),

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

  addAIMessage: (msg) =>
    set((s) => ({ aiMessages: [...s.aiMessages, msg] })),

  setAIStreaming: (v) => set({ aiStreaming: v }),

  clearAIMessages: () => set({ aiMessages: [] }),

  updateSettings: (partial) =>
    set((s) => ({ settings: { ...s.settings, ...partial } })),

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),

  setOutputPanelHeight: (h) => set({ outputPanelHeight: h }),
}));
