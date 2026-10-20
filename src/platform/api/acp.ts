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
  sessionId: string;
  harness: string;
  /** The directory the session was actually opened in (an empty request falls back to the app's). */
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
  kind: 'update' | 'permission' | 'stop' | 'error';
  payload: Record<string, unknown>;
}

export const acpHarnesses = () => invoke<HarnessConfig[]>('acp_harnesses');

/** Replace the configured list (the settings page is the caller). */
export const acpHarnessSave = (harnesses: HarnessConfig[]) => invoke<void>('acp_harness_save', { harnesses });

/** Start a configured harness, negotiate, and let it go again: the "test connection" action. */
export const acpHandshake = (name: string) => invoke<AgentDescription>('acp_handshake', { name });

/** Start a harness and open a session in `cwd` (`cwd` empty means the app's own working directory).
 *  Passing `resumeSessionId` reopens that session and replays its conversation instead. */
export const acpOpen = (name: string, cwd: string, resumeSessionId?: string) =>
  invoke<HarnessOpenResult>('acp_open', { name, cwd, resumeSessionId: resumeSessionId ?? null });

/** Send a prompt; the turn's content and its stop reason arrive as events. */
export const acpPrompt = (sessionId: string, text: string) => invoke<void>('acp_prompt', { sessionId, text });

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

/** Close a session; the harness process goes with it. */
export const acpClose = (sessionId: string) => invoke<void>('acp_close', { sessionId });

export function onAcpSession(handler: (event: AcpSessionEvent) => void): Promise<UnlistenFn> {
  return listen<AcpSessionEvent>('acp://session', (event) => handler(event.payload));
}
