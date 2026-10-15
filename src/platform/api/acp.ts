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

export interface HarnessOpenResult {
  sessionId: string;
  harness: string;
  agent: AgentDescription;
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

/** Start a harness and open a session in `cwd` (`cwd` empty means the app's own working directory). */
export const acpOpen = (name: string, cwd: string) => invoke<HarnessOpenResult>('acp_open', { name, cwd });

/** Send a prompt; the turn's content and its stop reason arrive as events. */
export const acpPrompt = (sessionId: string, text: string) => invoke<void>('acp_prompt', { sessionId, text });

/** Ask the agent to stop the current turn. */
export const acpCancel = (sessionId: string) => invoke<void>('acp_cancel', { sessionId });

/** Answer a permission request: an option the agent offered, or `null` for the protocol's cancel. */
export const acpAnswerPermission = (sessionId: string, toolCallId: string, optionId: string | null) =>
  invoke<void>('acp_answer_permission', { sessionId, toolCallId, optionId });

/** Close a session; the harness process goes with it. */
export const acpClose = (sessionId: string) => invoke<void>('acp_close', { sessionId });

export function onAcpSession(handler: (event: AcpSessionEvent) => void): Promise<UnlistenFn> {
  return listen<AcpSessionEvent>('acp://session', (event) => handler(event.payload));
}
