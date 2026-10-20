/**
 * harnessSessions — which session each harness last used, so reopening it continues the conversation.
 *
 * The agent keeps the history; this only remembers the id and the directory it belongs to, and the
 * page asks the agent to load that session. Closing the tab keeps the reference (reopening resumes);
 * the view's "New session" action forgets it.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface HarnessSessionRef {
  sessionId: string;
  /** The directory the session was opened in: the agent refuses to load it elsewhere. */
  cwd: string;
  /** Epoch milliseconds of the last use. */
  at: number;
}

interface HarnessSessionRefs {
  refs: Record<string, HarnessSessionRef>;
  remember: (harness: string, ref: HarnessSessionRef) => void;
  forget: (harness: string) => void;
}

export const useHarnessSessionRefs = create<HarnessSessionRefs>()(persist(
  (set) => ({
    refs: {},
    remember: (harness, ref) => set((state) => ({ refs: { ...state.refs, [harness]: ref } })),
    forget: (harness) => set((state) => {
      const { [harness]: _dropped, ...rest } = state.refs;
      return { refs: rest };
    }),
  }),
  { name: 'vrykell-harness-sessions', version: 1 },
));
