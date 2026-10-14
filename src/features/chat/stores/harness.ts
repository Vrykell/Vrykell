/**
 * harness — the state of the harness session pages.
 *
 * One entry per workspace tab. Nothing here decides anything security-relevant: the session, the
 * process and the answers to the agent's requests all live in Rust (see `docs/zh/security-model.md`),
 * and this store only keeps what the page renders and forwards the user's intent.
 */
import { create } from 'zustand';
import { t } from '@i18n';
import type { ChatMessage } from '@features/chat';
import { applyHarnessUpdate } from '@features/chat/model/harnessTranscript';
import {
  acpCancel, acpClose, acpOpen, acpPrompt, onAcpSession,
  type AcpSessionEvent, type AgentDescription,
} from '@platform/api/acp';

export interface HarnessSession {
  harness: string;
  sessionId: string | null;
  agent: AgentDescription | null;
  messages: ChatMessage[];
  /** A turn is in flight: the composer offers stop instead of send. */
  pending: boolean;
  /** The session is being opened. */
  opening: boolean;
  error: string | null;
  /** The last thing worth telling the user (a refused permission, a stop reason, ...). */
  note: string | null;
}

interface HarnessStore {
  byTab: Record<string, HarnessSession>;
  open: (tabId: string, harness: string, cwd: string) => Promise<void>;
  prompt: (tabId: string, text: string) => Promise<void>;
  cancel: (tabId: string) => Promise<void>;
  close: (tabId: string) => Promise<void>;
  applyEvent: (event: AcpSessionEvent) => void;
}

const fresh = (harness: string): HarnessSession => ({
  harness, sessionId: null, agent: null, messages: [], pending: false, opening: false, error: null, note: null,
});

/** sessionId → tabId, so an event finds its page. */
const tabOfSession = new Map<string, string>();
let binding: Promise<void> | null = null;

/** Subscribe to the backend's events once; every harness page calls this on mount. */
export function bindHarnessEvents(): void {
  if (binding) return;
  binding = onAcpSession((event) => useHarnessStore.getState().applyEvent(event))
    .then(() => undefined)
    .catch(() => { binding = null; });
}

/** Messages of a tab, patched through one function. */
function patch(tabId: string, update: (session: HarnessSession) => HarnessSession) {
  useHarnessStore.setState((state) => {
    const session = state.byTab[tabId];
    if (!session) return state;
    return { byTab: { ...state.byTab, [tabId]: update(session) } };
  });
}

export const useHarnessStore = create<HarnessStore>()((set, get) => ({
  byTab: {},

  open: async (tabId, harness, cwd) => {
    if (!(tabId in get().byTab)) {
      set((state) => ({ byTab: { ...state.byTab, [tabId]: fresh(harness) } }));
    }
    patch(tabId, (session) => ({ ...session, opening: true, error: null }));
    try {
      const result = await acpOpen(harness, cwd);
      tabOfSession.set(result.sessionId, tabId);
      patch(tabId, (session) => ({
        ...session, opening: false, sessionId: result.sessionId, agent: result.agent, error: null,
      }));
    } catch (error) {
      patch(tabId, (session) => ({ ...session, opening: false, error: String((error as Error)?.message ?? error) }));
    }
  },

  prompt: async (tabId, text) => {
    const session = get().byTab[tabId];
    if (!session?.sessionId || session.pending || !text.trim()) return;
    const question: ChatMessage = {
      id: `harness-question-${Date.now()}`, role: 'user', content: text.trim(), createdAt: Date.now(),
    };
    patch(tabId, (current) => ({ ...current, messages: [...current.messages, question], pending: true, note: null, error: null }));
    try {
      await acpPrompt(session.sessionId, text.trim());
    } catch (error) {
      patch(tabId, (current) => ({ ...current, pending: false, error: String((error as Error)?.message ?? error) }));
    }
  },

  cancel: async (tabId) => {
    const session = get().byTab[tabId];
    if (!session?.sessionId) return;
    try {
      await acpCancel(session.sessionId);
    } catch (error) {
      patch(tabId, (current) => ({ ...current, note: String((error as Error)?.message ?? error) }));
    }
  },

  close: async (tabId) => {
    const session = get().byTab[tabId];
    if (session?.sessionId) {
      tabOfSession.delete(session.sessionId);
      await acpClose(session.sessionId).catch(() => {});
    }
    set((state) => {
      const { [tabId]: _dropped, ...rest } = state.byTab;
      return { byTab: rest };
    });
  },

  applyEvent: (event) => {
    const tabId = tabOfSession.get(event.sessionId);
    if (!tabId) return;
    patch(tabId, (session) => {
      switch (event.kind) {
        case 'update':
          return { ...session, messages: applyHarnessUpdate(session.messages, event.payload) };
        case 'stop': {
          const reason = String(event.payload.stopReason ?? '');
          const note = reason === 'cancelled'
            ? t('Harness stopped.')
            : reason && reason !== 'end_turn' ? t('The harness stopped the turn: {{reason}}', { reason }) : null;
          return { ...session, pending: false, note };
        }
        case 'error':
          return { ...session, pending: false, error: String(event.payload.message ?? t('The harness failed.')) };
        case 'permission': {
          // Phase 1 has no approval card for harnesses, and the backend refuses; say so on the row
          // instead of leaving the user wondering why a tool never ran.
          const note = t('The harness asked for permission. Approvals for harnesses arrive in the next phase, so it was refused.');
          const toolCall = (event.payload.toolCall ?? {}) as Record<string, unknown>;
          const toolCallId = String(toolCall.toolCallId ?? '');
          const messages = session.messages.map((message) => {
            if (!message.parts) return message;
            return {
              ...message,
              parts: message.parts.map((part) => part.kind === 'tool' && part.tool.toolCallId === toolCallId
                ? { kind: 'tool' as const, tool: { ...part.tool, state: 'denied' as const, danger: note } }
                : part),
            };
          });
          return { ...session, messages, note };
        }
        default:
          return session;
      }
    });
  },
}));
