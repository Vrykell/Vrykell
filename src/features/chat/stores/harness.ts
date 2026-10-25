/**
 * harness — the state of the harness session pages.
 *
 * One entry per internal connection tab. Nothing here decides anything security-relevant: the session, the
 * process and the answers to the agent's requests all live in Rust (see `docs/zh/security-model.md`),
 * and this store only keeps what the page renders and forwards the user's intent.
 */
import { create } from 'zustand';
import { t } from '@i18n';
import type { ChatMessage } from '@features/chat';
import { applyHarnessUpdate, harnessUpdate, upsertHarnessTool } from '@features/chat/model/harnessTranscript';
import {
  acpAnswerPermission, acpCancel, acpClose, acpOpen, acpPrompt, acpSetConfigOption, acpSetMode, acpSetModel,
  onAcpSession, acpAppToolResult,
  type AcpConfigOption, type AcpSessionEvent, type AcpSessionModes, type AcpSessionModels, type AgentDescription,
} from '@platform/api/acp';
import { useUsageStore } from '@features/agent/stores/usage';
import { useHarnessSessionRefs } from './harnessSessions';
import { useToastStore } from '@ui/feedback/Toast';
import { ApplicationToolSession, applicationToolCatalog } from '@features/agent/services/applicationTools';
import { clearSessionGrants } from '@features/agent/stores/permissions';
import { executionPaneSpec } from '@features/agent/services/executionTarget';
import { environmentForPane } from '../services/conversationContext';
import { hasChatContent } from '../model/chatContent';
import { terminalDebug } from '@features/terminal/services/terminalDebug';

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
  queuedInputs?: Array<{ id: string; text: string }>;
  stopping?: boolean;
  interrupted?: boolean;
  resumeSessionId?: string;
  appToolsConnected?: boolean;
  executionPaneId?: string | null;
  toolContextId?: string;
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
  cancelQueuedInput: (tabId: string, id: string) => void;
  setExecutionPane: (tabId: string, paneId: string | null) => void;
  byTab: Record<string, HarnessSession>;
  open: (tabId: string, harness: string, cwd: string, fresh?: boolean, resumeSessionId?: string) => Promise<void>;
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
  queuedInputs: [], stopping: false,
  harness, sessionId: null, cwd: '', agent: null, messages: [], pending: false, opening: false, error: null, note: null,
  modes: null, models: null, configOptions: null, plan: [], context: null, commands: [],
  permission: null, permissionGeneration: 0,
});

/** sessionId → tabId, so an event finds its page. */
const tabOfSession = new Map<string, string>();
const openingEvents = new Map<string, AcpSessionEvent[]>();
let binding: Promise<void> | null = null;
const applicationSessions = new Map<string, ApplicationToolSession>();
let toolScopeSequence = 0;
let inputSequence = 0;
const openVersions = new Map<string, number>();
const turnVersions = new Map<string, number>();
const cancellationAcks = new Map<string, () => void>();
function drainHarnessQueue(tabId: string) {
  const session = useHarnessStore.getState().byTab[tabId];
  if (!session || session.pending || session.opening || session.stopping || !session.queuedInputs?.length) return;
  const [next, ...rest] = session.queuedInputs;
  patch(tabId, current => ({ ...current, queuedInputs: rest }));
  if (next) void useHarnessStore.getState().prompt(tabId, next.text);
}
function stopApplicationTools(tabId: string) { applicationSessions.get(tabId)?.close(); applicationSessions.delete(tabId); }

/** Subscribe to the backend's events once; every harness page calls this on mount. */
export function bindHarnessEvents(): Promise<void> {
  if (binding) return binding;
  binding = onAcpSession((event) => useHarnessStore.getState().applyEvent(event))
    .then(() => undefined)
    .catch((error: unknown) => { binding = null; throw error; });
  return binding;
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
  cancelQueuedInput: (tabId, id) => patch(tabId, current => ({ ...current, queuedInputs: current.queuedInputs?.filter(item => item.id !== id) })),

  setExecutionPane: (tabId, paneId) => {
    const session = get().byTab[tabId];
    if (!session || session.pending || session.stopping || (session.executionPaneId ?? null) === paneId || (paneId && !executionPaneSpec(paneId))) return;
    clearSessionGrants(session.toolContextId ?? tabId);
    patch(tabId, current => ({ ...current, executionPaneId: paneId, toolContextId: `${session.sessionId}:app:${++toolScopeSequence}` }));
  },

  open: async (tabId, harness, cwd, newSession = false, resumeSessionId) => {
    // One open per tab prevents a remount racing the first attempt from starting an extra process.
    if (get().byTab[tabId]?.opening) return;
    const version = (openVersions.get(tabId) ?? 0) + 1; openVersions.set(tabId, version);
    if (!(tabId in get().byTab)) {
      set((state) => ({ byTab: { ...state.byTab, [tabId]: fresh(harness) } }));
    }
    patch(tabId, (session) => ({ ...session, opening: true, error: null }));
    try {
      await bindHarnessEvents();
      // Resume the harness's last conversation when we remember one from the same directory; the
      // agent replays it and the replay travels back with the open result. A stale reference (a
      // deleted session, another directory) falls back to a new session inside the backend.
      const stored = useHarnessSessionRefs.getState().refs[harness];
      const resume = resumeSessionId ?? (!newSession && stored && (!cwd || stored.cwd === cwd) ? stored.sessionId : undefined);
      const result = await acpOpen(harness, cwd, resume, applicationToolCatalog());
      tabOfSession.set(result.sessionId, tabId);
      const known = get().byTab[tabId];
      if (!known || openVersions.get(tabId) !== version) {
        // The tab was closed while this open was in flight: do not resurrect it, and do not leave a
        // process running with no page behind it. (A React remount keeps the entry, so it lands in
        // the branch below instead.)
        await acpClose(result.sessionId).catch(() => undefined);
        tabOfSession.delete(result.sessionId);
        return;
      }
      const replayed = result.replayed ?? [];
      patch(tabId, (current) => replayEvents({
        ...current, opening: false, stopping: false, sessionId: result.sessionId, resumeSessionId: result.resumeSessionId ?? result.sessionId, cwd: result.cwd || cwd,
        messages: replayed.length ? [] : current.messages,
        agent: result.agent, error: null, appToolsConnected: result.appToolsConnected ?? false, toolContextId: `${result.sessionId}:app:${++toolScopeSequence}`,
        modes: result.modes ?? null, models: result.models ?? null, configOptions: result.configOptions ?? null,
        note: null,
      }, replayed));
      if (get().byTab[tabId]?.messages.some(hasChatContent)) useHarnessSessionRefs.getState().remember(harness, {
        sessionId: result.resumeSessionId ?? result.sessionId, cwd: result.cwd || cwd, at: Date.now(),
      });
      const queued = openingEvents.get(result.sessionId) ?? [];
      openingEvents.delete(result.sessionId);
      for (const event of queued) get().applyEvent(event);
      queueMicrotask(() => drainHarnessQueue(tabId));
    } catch (error) {
      if (openVersions.get(tabId) === version) patch(tabId, (session) => ({ ...session, opening: false, error: String((error as Error)?.message ?? error) }));
    } finally {
      if (!Object.values(get().byTab).some(session => session.opening)) openingEvents.clear();
    }
  },

  prompt: async (tabId, text) => {
    let session = get().byTab[tabId];
    if (!session || !text.trim()) return;
    if (session.pending || session.stopping || session.opening) {
      patch(tabId, current => ({ ...current, queuedInputs: [...(current.queuedInputs ?? []), { id: `queued-${Date.now()}-${inputSequence++}`, text: text.trim() }] }));
      return;
    }
    const version = (turnVersions.get(tabId) ?? 0) + 1; turnVersions.set(tabId, version);
    if (!session.sessionId) {
      patch(tabId, current => ({ ...current, pending: true }));
      await get().open(tabId, session.harness, session.cwd, false, session.resumeSessionId);
      if (turnVersions.get(tabId) !== version) return;
      session = get().byTab[tabId];
      if (!session?.sessionId) { patch(tabId, current => ({ ...current, pending: false })); return; }
    }
    const sessionId = session.sessionId;
    const question: ChatMessage = {
      id: `harness-question-${Date.now()}-${inputSequence++}`, role: 'user', content: text.trim(), createdAt: Date.now(),
    };
    patch(tabId, (current) => ({ ...current, messages: [...current.messages, question], pending: true, interrupted: false, note: null, error: null }));
    useHarnessSessionRefs.getState().remember(session.harness, { sessionId: session.resumeSessionId ?? sessionId, cwd: session.cwd, at: Date.now() });
    stopApplicationTools(tabId);
    const paneId = session.executionPaneId ?? null;
    const toolEnvironment = paneId ? environmentForPane(paneId) : null;
    applicationSessions.set(tabId, new ApplicationToolSession({ tabId: session.toolContextId ?? tabId, paneId, remote: executionPaneSpec(paneId)?.kind === 'ssh' }, run => {
      if (turnVersions.get(tabId) !== version) return;
      patch(tabId, current => ({ ...current, messages: upsertHarnessTool(current.messages, run, { paneId: paneId ?? undefined, environment: toolEnvironment }) }));
    }));
    try {
      await acpPrompt(sessionId, text.trim());
    } catch (error) {
      if (turnVersions.get(tabId) !== version || get().byTab[tabId]?.sessionId !== sessionId) return;
      stopApplicationTools(tabId);
      patch(tabId, (current) => ({ ...current, pending: false, error: String((error as Error)?.message ?? error) }));
      queueMicrotask(() => drainHarnessQueue(tabId));
    }
  },

  cancel: async (tabId) => {
    stopApplicationTools(tabId);
    const session = get().byTab[tabId];
    if (!session || session.stopping) return;
    turnVersions.set(tabId, (turnVersions.get(tabId) ?? 0) + 1);
    if (!session.sessionId) {
      openVersions.set(tabId, (openVersions.get(tabId) ?? 0) + 1);
      patch(tabId, current => ({ ...current, opening: false, pending: false, queuedInputs: [], permission: null }));
      return;
    }
    patch(tabId, current => ({ ...current, pending: false, stopping: true, interrupted: true, permission: null, queuedInputs: [], note: t('Harness stopped.') }));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const acknowledged = await new Promise<boolean>(resolve => {
      cancellationAcks.set(tabId, () => resolve(true));
      timer = setTimeout(() => resolve(false), 1200);
      void acpCancel(session.sessionId!).catch(() => resolve(false));
    });
    clearTimeout(timer); cancellationAcks.delete(tabId);
    if (get().byTab[tabId]?.sessionId !== session.sessionId) return;
    if (!acknowledged) {
      tabOfSession.delete(session.sessionId);
      patch(tabId, current => ({ ...current, sessionId: null, stopping: false, opening: false }));
      void acpClose(session.sessionId).catch(() => undefined);
    } else patch(tabId, current => ({ ...current, stopping: false }));
    terminalDebug('harness-turn-stopped', { tabId, acknowledged });
    drainHarnessQueue(tabId);
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
    openVersions.set(tabId, (openVersions.get(tabId) ?? 0) + 1);
    turnVersions.set(tabId, (turnVersions.get(tabId) ?? 0) + 1);
    cancellationAcks.get(tabId)?.(); cancellationAcks.delete(tabId);
    stopApplicationTools(tabId);
    const session = get().byTab[tabId];
    clearSessionGrants(session?.toolContextId ?? tabId);
    set((state) => {
      const { [tabId]: _dropped, ...rest } = state.byTab;
      return { byTab: rest };
    });
    if (session?.sessionId) {
      tabOfSession.delete(session.sessionId);
      await acpClose(session.sessionId).catch(() => {
        useToastStore.getState().addToast(t('Could not close the agent session.'), 'error');
      });
    }
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
    if (!tabId) {
      if (Object.values(get().byTab).some(session => session.opening)) {
        const queued = openingEvents.get(event.sessionId) ?? [];
        if (queued.length < 1000) openingEvents.set(event.sessionId, [...queued, event]);
      }
      return;
    }
    const session = get().byTab[tabId];
    if (session?.stopping && (event.kind === 'update' || event.kind === 'permission')) return;
    if (session?.interrupted && !session.pending && event.kind === 'update') {
      const kind = String(harnessUpdate(event.payload).sessionUpdate ?? '');
      if (['agent_message_chunk', 'agent_thought_chunk', 'user_message_chunk', 'tool_call', 'tool_call_update'].includes(kind)) return;
    }
    if (event.kind === 'app-tool') {
      if (event.payload.method === 'cancel') { stopApplicationTools(tabId); return; }
      const requestId = event.payload.requestId;
      const name = event.payload.name;
      if (typeof requestId !== 'string' || typeof name !== 'string') return;
      const tools = applicationSessions.get(tabId);
      const result = session?.pending && tools ? tools.call(requestId, name, event.payload.arguments)
        : Promise.resolve({ content: [{ type: 'text', text: 'The agent turn is no longer active.' }], isError: true });
      void result.then(payload => acpAppToolResult(event.sessionId, requestId, payload)).catch(() => undefined);
      return;
    }
    if (event.kind === 'stop' || event.kind === 'error') stopApplicationTools(tabId);
    // The usage panel counts what the ACP servers report about their own sessions. A loaded
    // conversation arrives through `replayEvents`, which must not count it a second time.
    if (session) recordAcpEvent(session.harness, event);
    patch(tabId, (current) => foldSessionEvent(current, event));
    if (event.kind === 'stop' || event.kind === 'error') {
      if (session?.stopping) cancellationAcks.get(tabId)?.();
      else queueMicrotask(() => drainHarnessQueue(tabId));
    }
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
      return { ...session, pending: false, permission: null, note };
    }
    case 'error':
      return { ...session, pending: false, permission: null, error: String(event.payload.message ?? t('The harness failed.')) };
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
