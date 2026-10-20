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
import { applyHarnessUpdate, harnessUpdate } from '@features/chat/model/harnessTranscript';
import {
  acpAnswerPermission, acpCancel, acpClose, acpOpen, acpPrompt, acpSetConfigOption, acpSetMode, acpSetModel,
  onAcpSession,
  type AcpConfigOption, type AcpSessionEvent, type AcpSessionModes, type AcpSessionModels, type AgentDescription,
} from '@platform/api/acp';
import { useUsageStore } from '@features/agent/stores/usage';
import { useHarnessSessionRefs } from './harnessSessions';

/** One step of the plan an agent publishes while it works. */
export interface HarnessPlanEntry {
  content: string;
  status?: string;
  priority?: string;
}

/** One slash command the agent advertises for this session. */
export interface HarnessCommand {
  name: string;
  description: string;
  /** The input the command expects, shown while it is being typed. */
  hint?: string;
}

export interface HarnessSession {
  harness: string;
  sessionId: string | null;
  /** The directory the session runs in; a restart reopens there. */
  cwd: string;
  agent: AgentDescription | null;
  messages: ChatMessage[];
  /** A turn is in flight: the composer offers stop instead of send. */
  pending: boolean;
  /** The session is being opened. */
  opening: boolean;
  error: string | null;
  /** The last thing worth telling the user (a refused permission, a stop reason, ...). */
  note: string | null;
  /** The modes the agent offers (legacy mode API; new agents publish them as config options). */
  modes: AcpSessionModes | null;
  /** The models the agent offers (legacy model API, still what the current adapters answer). */
  models: AcpSessionModels | null;
  /** Session-level selectors in the protocol's newer shape. */
  configOptions: AcpConfigOption[] | null;
  /** The plan the agent last published, if it publishes one. */
  plan: HarnessPlanEntry[];
  /** The context window in use, as the agent last reported it. */
  context: { used: number; size: number } | null;
  /** Slash commands the agent advertised for this session. */
  commands: HarnessCommand[];
  /** A permission request waiting for the user, rendered as a card in the transcript. */
  permission: {
    toolCallId: string;
    /** How many requests this tool call has produced; a card may only answer the instance it drew. */
    generation: number;
    title: string;
    options: Array<{ optionId: string; name: string }>;
  } | null;
  /** Counts the permission requests this session has shown, so every card has its own instance. */
  permissionGeneration: number;
}

interface HarnessStore {
  byTab: Record<string, HarnessSession>;
  open: (tabId: string, harness: string, cwd: string) => Promise<void>;
  /** End the current session and open a fresh one in the same directory. */
  restart: (tabId: string) => Promise<void>;
  prompt: (tabId: string, text: string) => Promise<void>;
  cancel: (tabId: string) => Promise<void>;
  close: (tabId: string) => Promise<void>;
  /** Switch the session mode (legacy mode API). */
  setMode: (tabId: string, modeId: string) => Promise<void>;
  /** Switch the session model (legacy model API). */
  setModel: (tabId: string, modelId: string) => Promise<void>;
  /** Set a session config option; the answer carries the complete configuration state. */
  setConfigOption: (tabId: string, configId: string, value: string | boolean) => Promise<void>;
  /** Answer the waiting permission request; `null` refuses it. `generation` is the card's own, so a
   *  click that lands after a newer request replaced the card cannot answer the wrong one. */
  answerPermission: (tabId: string, generation: number, optionId: string | null) => Promise<void>;
  applyEvent: (event: AcpSessionEvent) => void;
}

const fresh = (harness: string): HarnessSession => ({
  harness, sessionId: null, cwd: '', agent: null, messages: [], pending: false, opening: false, error: null, note: null,
  modes: null, models: null, configOptions: null, plan: [], context: null, commands: [],
  permission: null, permissionGeneration: 0,
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
    // One open per tab: a second click on restart (or a remount racing the first attempt) would
    // otherwise start a second agent process that nothing would ever close.
    if (get().byTab[tabId]?.opening) return;
    if (!(tabId in get().byTab)) {
      set((state) => ({ byTab: { ...state.byTab, [tabId]: fresh(harness) } }));
    }
    patch(tabId, (session) => ({ ...session, opening: true, error: null }));
    try {
      // Resume the harness's last conversation when we remember one from the same directory; the
      // agent replays it and the replay travels back with the open result. A stale reference (a
      // deleted session, another directory) falls back to a new session inside the backend.
      const stored = useHarnessSessionRefs.getState().refs[harness];
      const resume = stored && (!cwd || stored.cwd === cwd) ? stored.sessionId : undefined;
      const result = await acpOpen(harness, cwd, resume);
      tabOfSession.set(result.sessionId, tabId);
      useHarnessSessionRefs.getState().remember(harness, {
        sessionId: result.sessionId, cwd: result.cwd || cwd, at: Date.now(),
      });
      const known = get().byTab[tabId];
      if (!known) {
        // The tab was closed while this open was in flight: do not resurrect it, and do not leave a
        // process running with no page behind it. (A React remount keeps the entry, so it lands in
        // the branch below instead.)
        await acpClose(result.sessionId).catch(() => undefined);
        tabOfSession.delete(result.sessionId);
        return;
      }
      const replayed = result.replayed ?? [];
      patch(tabId, (current) => replayEvents({
        ...current, opening: false, sessionId: result.sessionId, cwd: result.cwd || cwd,
        agent: result.agent, error: null,
        modes: result.modes ?? null, models: result.models ?? null, configOptions: result.configOptions ?? null,
        note: replayed.length > 0 ? t('Resumed the previous conversation.') : current.note,
      }, replayed));
    } catch (error) {
      patch(tabId, (session) => ({ ...session, opening: false, error: String((error as Error)?.message ?? error) }));
    }
  },

  restart: async (tabId) => {
    const session = get().byTab[tabId];
    // An open that is still running owns the tab; restarting under it would race two agent processes.
    if (!session || session.opening) return;
    const { harness, cwd } = session;
    // A restart is how the user says "forget that conversation": the reference goes first, or the
    // open below would load it straight back.
    useHarnessSessionRefs.getState().forget(harness);
    if (session.sessionId) {
      tabOfSession.delete(session.sessionId);
      await acpClose(session.sessionId).catch(() => undefined);
    }
    set((state) => ({ byTab: { ...state.byTab, [tabId]: fresh(harness) } }));
    await get().open(tabId, harness, cwd);
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

  setMode: async (tabId, modeId) => {
    const session = get().byTab[tabId];
    if (!session?.sessionId) return;
    try {
      await acpSetMode(session.sessionId, modeId);
      // The agent may also send a current_mode_update; writing the value here keeps the control
      // responsive even for agents that stay quiet.
      patch(tabId, (current) => current.modes
        ? { ...current, modes: { ...current.modes, currentModeId: modeId } }
        : current);
    } catch (error) {
      patch(tabId, (current) => ({ ...current, error: String((error as Error)?.message ?? error) }));
    }
  },

  setModel: async (tabId, modelId) => {
    const session = get().byTab[tabId];
    if (!session?.sessionId) return;
    try {
      await acpSetModel(session.sessionId, modelId);
      patch(tabId, (current) => current.models
        ? { ...current, models: { ...current.models, currentModelId: modelId } }
        : current);
    } catch (error) {
      patch(tabId, (current) => ({ ...current, error: String((error as Error)?.message ?? error) }));
    }
  },

  setConfigOption: async (tabId, configId, value) => {
    const session = get().byTab[tabId];
    if (!session?.sessionId) return;
    try {
      const configOptions = await acpSetConfigOption(session.sessionId, configId, value);
      patch(tabId, (current) => ({
        ...current,
        configOptions: Array.isArray(configOptions) ? configOptions : current.configOptions,
      }));
    } catch (error) {
      patch(tabId, (current) => ({ ...current, error: String((error as Error)?.message ?? error) }));
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

  answerPermission: async (tabId, generation, optionId) => {
    const session = get().byTab[tabId];
    const request = session?.permission;
    // The answer names the session it belongs to: another harness may be using the same tool call id.
    if (!request || !session?.sessionId) return;
    // A newer request for the same tool call replaced the card this click was drawn on: the answer
    // belongs to the card that is gone, so it is dropped instead of applied to the new one.
    if (request.generation !== generation) return;
    // Clear it first: a card that is answered twice would answer an already-resolved request.
    patch(tabId, (current) => ({ ...current, permission: null }));
    try {
      await acpAnswerPermission(session.sessionId, request.toolCallId, optionId);
    } catch (error) {
      patch(tabId, (current) => ({ ...current, error: String((error as Error)?.message ?? error) }));
    }
  },

  applyEvent: (event) => {
    const tabId = tabOfSession.get(event.sessionId);
    if (!tabId) return;
    const session = get().byTab[tabId];
    // The usage panel counts what the ACP servers report about their own sessions. A loaded
    // conversation arrives through `replayEvents`, which must not count it a second time.
    if (session) recordAcpEvent(session.harness, event);
    patch(tabId, (current) => foldSessionEvent(current, event));
  },
}));

/** What one event does to the session view; shared by the live stream and a replayed history. */
function foldSessionEvent(session: HarnessSession, event: AcpSessionEvent): HarnessSession {
  switch (event.kind) {
    case 'update': {
      const update = harnessUpdate(event.payload);
      const kind = String(update.sessionUpdate ?? '');
      const next: HarnessSession = { ...session, messages: applyHarnessUpdate(session.messages, event.payload) };
      // Session state the agent pushes outside the transcript: the active mode, a whole new
      // configuration, its plan, its slash commands, and the context window in use.
      if (kind === 'current_mode_update' && next.modes) {
        next.modes = { ...next.modes, currentModeId: String(update.currentModeId ?? next.modes.currentModeId) };
      } else if (kind === 'config_option_update' && Array.isArray(update.configOptions)) {
        next.configOptions = update.configOptions as AcpConfigOption[];
      } else if (kind === 'plan' && Array.isArray(update.entries)) {
        next.plan = update.entries as HarnessPlanEntry[];
      } else if (kind === 'usage_update') {
        next.context = { used: Number(update.used ?? 0), size: Number(update.size ?? 0) };
      } else if (kind === 'available_commands_update' && Array.isArray(update.availableCommands)) {
        next.commands = (update.availableCommands as Array<Record<string, unknown>>)
          .map((command) => {
            const input = (command.input ?? {}) as Record<string, unknown>;
            return {
              name: String(command.name ?? ''),
              description: String(command.description ?? ''),
              hint: typeof input.hint === 'string' ? input.hint : undefined,
            };
          })
          .filter((command) => command.name.length > 0);
      }
      return next;
    }
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
      // The card waits for the user; the backend holds the agent until the answer comes back.
      const toolCall = (event.payload.toolCall ?? {}) as Record<string, unknown>;
      const toolCallId = String(toolCall.toolCallId ?? '');
      if (!toolCallId) return session;
      const options = Array.isArray(event.payload.options) ? event.payload.options : [];
      return {
        ...session,
        note: null,
        permissionGeneration: session.permissionGeneration + 1,
        permission: {
          toolCallId,
          generation: session.permissionGeneration + 1,
          title: String(toolCall.title ?? toolCallId),
          options: options.map((option) => {
            const entry = (option ?? {}) as Record<string, unknown>;
            return { optionId: String(entry.optionId ?? ''), name: String(entry.name ?? entry.optionId ?? '') };
          }).filter((option) => option.optionId),
        },
      };
    }
    default:
      return session;
  }
}

/** Fold the history a loaded session replayed, in order. */
function replayEvents(session: HarnessSession, events: AcpSessionEvent[]): HarnessSession {
  return events.reduce((current, event) => foldSessionEvent(current, event), session);
}

/**
 * Feed the usage panel from the ACP event stream.
 *
 * ACP reports the context window and the cumulative cost, never a per-turn token split, so only
 * the facts the protocol carries are recorded: turns, tool calls, context use and cost.
 */
function recordAcpEvent(source: string, event: AcpSessionEvent) {
  const usage = useUsageStore.getState();
  if (event.kind === 'stop') {
    usage.acpTurn(source);
    return;
  }
  if (event.kind !== 'update') return;
  // The notification arrives whole (jsonrpc/method/params) and some agents hand the params object
  // itself, so the update sits under `params.update` or `update` — the same shapes the transcript
  // folding accepts.
  const update = harnessUpdate(event.payload);
  const kind = String(update.sessionUpdate ?? '');
  if (kind === 'tool_call') {
    usage.acpToolCall(source);
    return;
  }
  if (kind === 'usage_update') {
    const cost = update.cost as Record<string, unknown> | undefined;
    usage.acpUsage(source, {
      used: Number(update.used ?? 0),
      size: Number(update.size ?? 0),
      cost: cost ? Number(cost.amount ?? 0) : undefined,
      currency: cost ? String(cost.currency ?? '') : undefined,
    });
  }
}
