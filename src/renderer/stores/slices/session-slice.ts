import { StateCreator } from 'zustand';
import { SessionInfo } from '@shared/types';

export interface SessionSlice {
  sessions: SessionInfo[];
  activeSessionId: string | null;
  addSession: (session: SessionInfo) => void;
  removeSession: (id: string) => void;
  setActive: (id: string) => void;
  updateSessionTitle: (id: string, title: string) => void;
}

export const createSessionSlice: StateCreator<SessionSlice> = (set) => ({
  sessions: [],
  activeSessionId: null,

  addSession: (session) =>
    set((s) => ({
      sessions: [...s.sessions, session],
      activeSessionId: s.activeSessionId || session.id,
    })),

  removeSession: (id) =>
    set((s) => {
      const sessions = s.sessions.filter((ses) => ses.id !== id);
      return {
        sessions,
        activeSessionId: s.activeSessionId === id ? sessions[0]?.id || null : s.activeSessionId,
      };
    }),

  setActive: (id) => set({ activeSessionId: id }),

  updateSessionTitle: (id, title) =>
    set((s) => ({
      sessions: s.sessions.map((ses) => (ses.id === id ? { ...ses, title } : ses)),
    })),
});
