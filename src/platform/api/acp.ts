/**
 * acp — the frontend surface of the harness session in Rust.
 *
 * Everything that talks to an agent process stays behind these commands: the page asks for a
 * session, sends prompts and listens to `acp://session` events. It never sees a process handle, and
 * the answers to the agent's own requests are decided in Rust (see `docs/zh/security-model.md`).
 */
import { invoke } from '@platform/diagnostics';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

/** One configured harness, as the settings list shows it (command and arguments included on purpose). */
export interface HarnessConfig {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
  enabled: boolean;
}

export interface AgentInfo {
  name?: string;
  title?: string;
  version?: string;
}

export interface AgentDescription {
  protocolVersion: number | null;
  agentInfo: AgentInfo | null;
  agentCapabilities: Record<string, unknown> | null;
  authMethods: unknown;
}

export interface AcpSessionMode {
  id: string;
  name: string;
  description?: string;
}

/** The modes an agent offers (the older mode API, which the current adapters still answer). */
export interface AcpSessionModes {
  currentModeId: string;
  availableModes: AcpSessionMode[];
}

export interface AcpModelInfo {
  modelId: string;
  name?: string;
  description?: string | null;
}

/** The models an agent offers (the older model API). */
export interface AcpSessionModels {
  currentModelId: string;
  availableModels: AcpModelInfo[];
}

export interface AcpConfigValue {
  value: string;
  name: string;
  description?: string;
}

export interface AcpConfigGroup {
  group: string;
  name: string;
  options: AcpConfigValue[];
}

/** One session-level selector (mode, model, reasoning level, ...) in the protocol's newer shape. */
export interface AcpConfigOption {
  id: string;
  name: string;
  description?: string;
  category?: string;
  type?: string;
  currentValue: string | boolean;
  options?: Array<AcpConfigValue | AcpConfigGroup>;
}

export interface HarnessOpenResult {
  appToolsConnected?: boolean;
  sessionId: string;
  /** Agent-owned history id; the live session id is local to the client runtime. */
  resumeSessionId?: string;
  harness: string;
  /** The directory the session was actually opened in (an empty request gets a fresh folder). */
  cwd: string;
  agent: AgentDescription;
  /** Session state the agent published with the session; null when it publishes none. */
  modes: AcpSessionModes | null;
  models: AcpSessionModels | null;
  configOptions: AcpConfigOption[] | null;
  /** The conversation an agent replayed for a loaded session, in arrival order. */
  replayed?: AcpSessionEvent[];
}

/** What the backend pushes while a session lives. */
export interface AcpSessionEvent {
  sessionId: string;
  kind: 'update' | 'permission' | 'stop' | 'error' | 'app-tool' | 'elicitation' | 'elicitation-end';
  payload: Record<string, unknown>;
}

export const acpHarnesses = () => invoke<HarnessConfig[]>('acp_harnesses');

/** The root that holds the fresh folder of every session started without a chosen project. */
export const acpWorkspaceRoot = () => invoke<string>('acp_workspace_root');

/** Replace the configured list (the settings page is the caller). */
export const acpHarnessSave = (harnesses: HarnessConfig[]) => invoke<void>('acp_harness_save', { harnesses });

/** Start a configured harness, negotiate, and let it go again: the "test connection" action. */
export const acpHandshake = (name: string) => invoke<AgentDescription>('acp_handshake', { name });

/** Start a harness and open a session in `cwd` (an empty `cwd` gets a fresh folder in the app's
 *  default ACP workspace). Passing `resumeSessionId` reopens that session and replays its
 *  conversation instead. */
export const acpOpen = (name: string, cwd: string, resumeSessionId?: string, appTools?: Array<{ name: string; description?: string; inputSchema: Record<string, unknown> }>) =>
  invoke<HarnessOpenResult>('acp_open', { name, cwd, resumeSessionId: resumeSessionId ?? null, appTools: appTools ?? null });

export const acpAppToolResult = (sessionId: string, requestId: string, payload: unknown) =>
  invoke<void>('acp_app_tool_result', { sessionId, requestId, payload });

/** One image included in a prompt; the agent must advertise `promptCapabilities.image`. */
export interface AcpPromptImage {
  mimeType: string;
  /** Base64-encoded image bytes, without the `data:` URL prefix. */
  data: string;
}

/** Send a prompt; the turn's content and its stop reason arrive as events. */
export const acpPrompt = (sessionId: string, text: string, images: AcpPromptImage[] = []) =>
  invoke<void>('acp_prompt', { sessionId, text, images: images.length ? images : null });

/** Ask the agent to stop the current turn. */
export const acpCancel = (sessionId: string) => invoke<void>('acp_cancel', { sessionId });

/** Switch the session mode (legacy mode API). */
export const acpSetMode = (sessionId: string, modeId: string) => invoke<void>('acp_set_mode', { sessionId, modeId });

/** Switch the session model (legacy model API). */
export const acpSetModel = (sessionId: string, modelId: string) => invoke<void>('acp_set_model', { sessionId, modelId });

/** Set one session config option; the answer is the complete configuration state. */
export const acpSetConfigOption = (sessionId: string, configId: string, value: string | boolean) =>
  invoke<AcpConfigOption[] | null>('acp_set_config_option', { sessionId, configId, value });

/** Answer a permission request: an option the agent offered, or `null` for the protocol's cancel. */
export const acpAnswerPermission = (sessionId: string, toolCallId: string, optionId: string | null) =>
  invoke<void>('acp_answer_permission', { sessionId, toolCallId, optionId });

export interface AcpQuestionField {
  key: string; title: string; description: string; kind: 'string' | 'number' | 'integer' | 'boolean' | 'array'; required: boolean;
  options: Array<{ value: string; label: string; description: string }>;
  default: string | number | boolean | string[] | null;
  minimum: number | null; maximum: number | null; minLength: number; maxLength: number; minItems: number; maxItems: number;
}
export interface AcpQuestion { requestId: string; form: { message: string; fields: AcpQuestionField[] } }
export type AcpQuestionResponse = { action: 'accept'; content: Record<string, string | number | boolean | string[]> } | { action: 'decline' | 'cancel' };
export const acpAnswerElicitation = (sessionId: string, requestId: string, response: AcpQuestionResponse) =>
  invoke<void>('acp_answer_elicitation', { sessionId, requestId, response });

/** Close a session; the harness process goes with it. */
export const acpClose = (sessionId: string) => invoke<void>('acp_close', { sessionId });

/** Merge adjacent text deltas while preserving every boundary in delivery order. */
export function batchAcpEvents(handler: (event: AcpSessionEvent) => void) {
  let pending: AcpSessionEvent | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const chunk = (event: AcpSessionEvent) => {
    const params = event.payload.params;
    const update = (params && typeof params === 'object' ? (params as Record<string, unknown>).update : event.payload.update) as Record<string, unknown> | undefined;
    const content = update?.content as Record<string, unknown> | undefined;
    return event.kind === 'update' && ['agent_message_chunk', 'agent_thought_chunk', 'user_message_chunk'].includes(String(update?.sessionUpdate))
      && content?.type === 'text' && typeof content.text === 'string' ? { update: update!, content, text: content.text } : undefined;
  };
  const clear = () => { clearTimeout(timer); timer = undefined; };
  const flush = () => { clear(); const event = pending; pending = undefined; if (event) handler(event); };
  return {
    push(event: AcpSessionEvent) {
      const next = chunk(event);
      const previous = pending && chunk(pending);
      if (pending && previous && next && pending.sessionId === event.sessionId
        && previous.update.sessionUpdate === next.update.sessionUpdate && previous.text.length + next.text.length <= 64_000
        && JSON.stringify({ ...previous.update, content: { ...previous.content, text: undefined } })
          === JSON.stringify({ ...next.update, content: { ...next.content, text: undefined } })) {
        previous.content.text = previous.text + next.text;
        return;
      }
      flush();
      if (!next) { handler(event); return; }
      const update = { ...next.update, content: { ...next.content } };
      const params = event.payload.params;
      pending = { ...event, payload: params && typeof params === 'object'
        ? { ...event.payload, params: { ...params, update } } : { ...event.payload, update } };
      timer = setTimeout(flush, 50);
    },
    dispose() { clear(); pending = undefined; },
  };
}

export async function onAcpSession(handler: (event: AcpSessionEvent) => void): Promise<UnlistenFn> {
  const batch = batchAcpEvents(handler);
  const unlisten = await listen<AcpSessionEvent>('acp://session', event => batch.push(event.payload));
  return () => { batch.dispose(); unlisten(); };
}
