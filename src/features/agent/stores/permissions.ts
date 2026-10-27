/**
 * permissions — the webview side of tool authorization.
 *
 * The policy itself lives in Rust (`src-tauri/src/agent/permissions.rs`): the level table (it
 * persists `~/.vrykell/permissions.json`), the danger / credential / durable-action heuristics,
 * and the single-use leases. This module keeps a mirror of the levels for the settings UI and
 * for the synchronous "which tools exist" decisions, drives the approval card, and hands the
 * lease back to the caller so the gated command can present it.
 *
 * Decisions come back as "allow" (with a lease), "ask" (the card below decides) or "deny".
 * Dangerous and credential-touching calls are confirmed by Rust through a native system dialog
 * instead of the card, so rendered content cannot answer them.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { t } from '@i18n';
import type { ToolRunState } from '@features/agent/model/messageParts';
import { untrustedSkillFor, setSkillState } from '@features/agent/services/skills';
import { reasonText } from '@features/agent/model/toolReasonTexts';
import {
  approveToolCall,
  authorizeToolCall,
  clearToolSessionGrants,
  loadToolPolicy,
  setToolPolicyLevel,
  type AuthorizeRequest,
  type ToolDecision,
} from '@features/agent/services/toolPolicy';

export type ToolLevel = 'allow' | 'ask' | 'deny';
/**
 * How an approval was answered. `timeout` never comes from a button: the bridge resolves it when
 * the card waited past its deadline, so a turn can never hang on an empty chair. `shape` approves
 * one kind of command for the rest of the session, the narrowest of the three grants.
 */
export type ApprovalDecision = 'once' | 'session' | 'deny' | 'timeout' | 'shape';
export type PermissionMode = 'standard' | 'strict' | 'relaxed';

/** How long an approval card waits for an answer before it denies itself. */
export const DEFAULT_APPROVAL_TIMEOUT_SECONDS = 300;
export const MIN_APPROVAL_TIMEOUT_SECONDS = 60;
export const MAX_APPROVAL_TIMEOUT_SECONDS = 1800;

/** Shared tool result shape (matches the structured convention in tools/*). */
export interface GateResult {
  ok: boolean;
  denied?: boolean;
  error?: string;
}

export interface ToolContext {
  memoryScope?: string;
  signal?: AbortSignal;
  /** A fixed execution target; null explicitly disables terminal access. */
  paneId?: string | null;
  remote?: boolean;
  /** Shell of the execution target: picks the danger-rule table (Windows shells also run POSIX-shaped aliases). */
  shellType?: string | null;
  /** Conversation id (= workspace tabId) that anchors the approval card. */
  tabId?: string;
  /** Approval state callback (agentStream upserts the ToolRun from it); shape marks an "allow this kind for this session" choice, input carries the edited command. */
  setToolState?: (toolCallId: string, state: ToolRunState, extra?: { danger?: string; shape?: string; input?: Record<string, unknown> }) => void;
}

/** Every managed tool (the settings table renders from this list; add new tools here). */
export const TOOL_NAMES = [
  'run_command',
  'read_file',
  'write_file',
  'edit_file',
  'list_dir',
  'search_files',
  'web_search',
  'web_fetch',
  'web_crawl',
  'read_terminal',
  'terminal_keys',
  'use_skill',
  'install_skill',
  'mcp',
  'memory',
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

/**
 * Shipped defaults, mirrored from the Rust table so the UI can render before the backend
 * answers. Rust stays the authority for decisions and for what gets persisted.
 */
export const DEFAULT_LEVELS: Record<ToolName, ToolLevel> = {
  run_command: 'ask',
  read_file: 'allow',
  write_file: 'ask',
  edit_file: 'ask',
  list_dir: 'allow',
  search_files: 'allow',
  web_search: 'allow',
  web_fetch: 'allow',
  web_crawl: 'allow',
  read_terminal: 'allow',
  terminal_keys: 'ask',
  use_skill: 'allow',
  // Installing a skill writes instructions that are trusted afterwards.
  install_skill: 'ask',
  // MCP tools are arbitrary third-party capabilities.
  mcp: 'ask',
  memory: 'allow',
};

interface PermissionsState {
  /** Mirror of the backend table; render only — decisions come from Rust. */
  levels: Record<string, ToolLevel>;
  /** UI shortcut applied to plain calls: strict asks everything, relaxed allows everything. */
  mode: PermissionMode;
  /** Seconds an approval card waits before denying itself; also passed to the native confirm. */
  approvalTimeoutSeconds: number;
  setLevel: (tool: ToolName, level: ToolLevel) => void;
  setMode: (mode: PermissionMode) => void;
  setApprovalTimeout: (seconds: number) => void;
  /** Backfill from the backend policy (on startup and after settings changes). */
  applyPolicy: (levels: Record<string, ToolLevel>) => void;
}

export const usePermissions = create<PermissionsState>()(
  persist(
    (set) => ({
      levels: { ...DEFAULT_LEVELS },
      mode: 'standard',
      approvalTimeoutSeconds: DEFAULT_APPROVAL_TIMEOUT_SECONDS,
      setLevel: (tool, level) => {
        set((s) => ({ levels: { ...s.levels, [tool]: level }, mode: 'standard' }));
        // The backend is the authority: a failed write leaves the mirror stale on purpose (the
        // next refresh repairs it), whereas failing open would silently widen access.
        void setToolPolicyLevel(tool, level).catch((error: unknown) => {
          console.warn('[permissions] Could not persist the tool level:', error);
        });
      },
      setMode: (mode) => set({ mode }),
      setApprovalTimeout: (seconds) => set({
        approvalTimeoutSeconds: Math.min(
          MAX_APPROVAL_TIMEOUT_SECONDS,
          Math.max(MIN_APPROVAL_TIMEOUT_SECONDS, Math.round(seconds)),
        ),
      }),
      applyPolicy: (levels) => set((s) => ({ levels: { ...s.levels, ...levels } })),
    }),
    {
      name: 'vrykell-permissions',
      version: 3,
      // Levels moved to the backend; only the UI shortcut and the approval deadline stay local.
      migrate: (persisted: unknown) => {
        const saved = (persisted ?? {}) as { mode?: PermissionMode; approvalTimeoutSeconds?: number };
        return {
          levels: { ...DEFAULT_LEVELS },
          mode: saved.mode ?? 'standard',
          approvalTimeoutSeconds: saved.approvalTimeoutSeconds ?? DEFAULT_APPROVAL_TIMEOUT_SECONDS,
        };
      },
    },
  ),
);

/** Deadline of one approval wait, in milliseconds. */
export function approvalTimeoutMs(): number {
  const seconds = usePermissions.getState().approvalTimeoutSeconds;
  return Math.max(1, seconds) * 1000;
}

/** The same deadline as whole minutes, for the copy that names it. */
export function approvalTimeoutMinutes(): number {
  return Math.max(1, Math.round(approvalTimeoutMs() / 60_000));
}

/** Hydrate the mirror from the backend; a failure keeps the shipped defaults. */
export async function refreshToolPolicy(): Promise<void> {
  try {
    const levels = await loadToolPolicy();
    if (levels && typeof levels === 'object') usePermissions.getState().applyPolicy(levels);
  } catch (error) {
    console.warn('[permissions] Could not read the tool policy:', error);
  }
}

export function levelOf(tool: string): ToolLevel {
  const s = usePermissions.getState();
  if (s.mode === 'strict') return 'ask';
  if (s.mode === 'relaxed') return 'allow';
  return s.levels[tool] ?? 'ask';
}

// ── approval bridge ──

type ApprovalResolution = { decision: ApprovalDecision; command?: string };
const pending = new Map<string, { resolve: (result: ApprovalResolution) => void; owner?: string }>();

/**
 * Waits for the card's answer, but not forever: nobody may be in front of the app (a scheduled
 * turn, a locked screen), and a promise that never settles would hold the turn — and with it the
 * single send slot — for good. The deadline denies the call and says so in the transcript.
 */
function requestApproval(toolCallId: string, signal?: AbortSignal, owner?: string): Promise<ApprovalResolution> {
  if (signal?.aborted) return Promise.resolve({ decision: 'deny' });
  return new Promise((resolve) => {
    const cancel = () => resolveApproval(toolCallId, 'deny');
    const timer = window.setTimeout(() => {
      if (!pending.has(toolCallId)) return;
      pending.delete(toolCallId);
      signal?.removeEventListener('abort', cancel);
      resolve({ decision: 'timeout' });
    }, approvalTimeoutMs());
    pending.set(toolCallId, { owner, resolve: (result) => {
      window.clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      resolve(result);
    } });
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
  });
}

/** Entry point for the approval-card buttons. Unknown toolCallIds are ignored silently (a stop may already have cleaned them up). */
export function resolveApproval(toolCallId: string, decision: ApprovalDecision, command?: string) {
  pending.get(toolCallId)?.resolve({ decision, command });
  pending.delete(toolCallId);
}

/** Fallback for aborts and broken streams: resolve every pending approval as denied so execute cannot hang. */
export function denyAllPending(conversationId?: string) {
  for (const [id, entry] of pending) {
    if (conversationId && entry.owner !== conversationId) continue;
    entry.resolve({ decision: 'deny' });
    pending.delete(id);
  }
}

/** Revoke one conversation, or all temporary approvals from settings. */
const grantedConversations = new Set<string>();
export function clearSessionGrants(conversationId?: string) {
  if (conversationId && !grantedConversations.delete(conversationId)) return;
  if (!conversationId) grantedConversations.clear();
  void clearToolSessionGrants(conversationId).catch((error: unknown) => {
    console.warn('[permissions] Could not clear session grants:', error);
  });
}

/**
 * Trust confirmation for an untrusted skill: called when the agent wants to read, write or run a
 * file or script of a skill that is not trusted yet. Reuses the approval card; an allow proceeds
 * (the caller persists the trust) and a deny blocks.
 */
export async function ensureTrustedSkill(
  skillName: string,
  toolCallId: string | undefined,
  ctx: ToolContext,
): Promise<{ proceed: boolean; error?: string }> {
  if (!toolCallId || !ctx.setToolState || !ctx.tabId) {
    return {
      proceed: false,
      error: t('The current context cannot confirm trust, so access to the untrusted skill "{{skill}}" was denied.', { skill: skillName }),
    };
  }
  ctx.setToolState(toolCallId, 'approval-pending', {
    danger: t('Trusting "{{skill}}" grants access to its files and scripts.', { skill: skillName }),
  });
  const { decision } = await requestApproval(toolCallId, ctx.signal, ctx.tabId);
  if (decision === 'timeout') {
    ctx.setToolState(toolCallId, 'denied');
    return {
      proceed: false,
      error: t('No answer within {{minutes}} minutes, so trusting {{skill}} was refused.', {
        minutes: approvalTimeoutMinutes(),
        skill: skillName,
      }),
    };
  }
  if (decision === 'deny') {
    ctx.setToolState(toolCallId, 'denied');
    return { proceed: false, error: t('The skill "{{skill}}" is not trusted; access was denied.', { skill: skillName }) };
  }
  ctx.setToolState(toolCallId, 'running');
  return { proceed: true };
}

/**
 * Pre-execution check: when the text or path references an untrusted skill, ask for confirmation
 * to trust it first; approval persists the trust and proceeds, denial blocks.
 */
export async function ensureSkillAccess(
  text: string,
  toolCallId: string | undefined,
  ctx: ToolContext,
): Promise<{ proceed: boolean; error?: string }> {
  const name = await untrustedSkillFor(text);
  if (ctx.signal?.aborted) return { proceed: false, error: t('Tool call cancelled.') };
  if (!name) return { proceed: true };
  const r = await ensureTrustedSkill(name, toolCallId, ctx);
  if (!r.proceed) return r;
  if (ctx.signal?.aborted) return { proceed: false, error: t('Tool call cancelled.') };
  await setSkillState(name, true, undefined).catch(() => {});
  if (ctx.signal?.aborted) return { proceed: false, error: t('Tool call cancelled.') };
  return { proceed: true };
}

// ── authorization entry points (decided by Rust) ──

/** Injectable for tests: the backend call that decides a tool call. */
export type ToolAuthorizer = (request: AuthorizeRequest) => Promise<ToolDecision>;

/** Injectable for tests: the backend call that records the card's decision and mints the lease. */
export type ToolApprover = (
  tool: string,
  command: string | undefined,
  args: Record<string, unknown>,
  scope: 'once' | 'session' | 'shape',
  conversationId?: string,
) => Promise<ToolDecision>;

const backendAuthorizer: ToolAuthorizer = (request) => authorizeToolCall(request);
const backendApprover: ToolApprover = (tool, command, args, scope, conversationId) =>
  approveToolCall(tool, command, args, scope, conversationId);

let authorizer: ToolAuthorizer = backendAuthorizer;
let approver: ToolApprover = backendApprover;

/** Tests install stubs instead of mocking the whole IPC layer. */
export function setToolAuthorizer(next: ToolAuthorizer | null) {
  authorizer = next ?? backendAuthorizer;
}

export function setToolApprover(next: ToolApprover | null) {
  approver = next ?? backendApprover;
}

export type GateOutcome =
  | { proceed: true; lease?: string; command?: string }
  | { proceed: false; result: GateResult };

function denied(reason: string | undefined, fallback: string): GateOutcome {
  return { proceed: false, result: { ok: false, denied: true, error: reason ?? fallback } };
}

/**
 * First line of every tool execute. `command` is the gated backend command name
 * (read_file_text / fs_search …), and the lease is bound to it together with the arguments.
 * When it returns proceed:false, the result is returned as the tool result directly (with the
 * denied sentinel, which agentStream renders as a denied ring).
 */
export async function gate(
  toolName: ToolName,
  input: Record<string, unknown>,
  toolCallId: string | undefined,
  ctx: ToolContext,
  command?: string,
): Promise<GateOutcome> {
  if (ctx.signal?.aborted) return denied(undefined, t('Tool call cancelled.'));
  if (ctx.remote && ['read_file', 'write_file', 'edit_file', 'list_dir', 'search_files'].includes(toolName)) {
    return denied(undefined, t('Local file tools cannot access the remote execution host. Use terminal tools on the selected host.'));
  }
  const mode = usePermissions.getState().mode;
  let decision: ToolDecision;
  try {
    decision = await authorizer({
      tool: toolName,
      conversationId: ctx.tabId,
      command,
      args: input,
      shell: ctx.shellType ?? null,
      mode,
      reasonHint: t('This operation can change your system or reach your credentials.'),
      // The native confirmation for dangerous calls follows the same deadline as this card.
      timeoutSecs: Math.round(approvalTimeoutMs() / 1000),
    });
  } catch (error) {
    // Fail closed: without an authorization from the backend the tool must not run.
    console.warn('[permissions] Authorization unavailable:', error);
    return denied(undefined, t('Authorization is unavailable (the backend is offline); the operation was denied.'));
  }

  if (ctx.signal?.aborted) return denied(undefined, t('Tool call cancelled.'));
  const reason = reasonText(decision.reason);
  if (decision.decision === 'deny') {
    if (toolCallId) ctx.setToolState?.(toolCallId, 'denied', reason ? { danger: reason } : undefined);
    return denied(reason, t('The operation was denied.'));
  }
  if (decision.decision === 'allow') {
    return { proceed: true, ...(decision.lease ? { lease: decision.lease } : {}) };
  }
  // ask: suspend until approved. Without setToolState/tabId there is no interactive context (tests, for example), so deny.
  if (!toolCallId || !ctx.setToolState || !ctx.tabId) {
    return denied(undefined, t('The current context cannot request approval; the operation was denied.'));
  }
  // The shape Rust derived for this call labels the card's narrowest choice; without one the card
  // offers the whole-tool session approval instead.
  const shape = decision.shape ?? undefined;
  const cardExtra = { ...(reason ? { danger: reason } : {}), ...(shape ? { shape } : {}) };
  ctx.setToolState(toolCallId, 'approval-pending', Object.keys(cardExtra).length > 0 ? cardExtra : undefined);
  const choice = await requestApproval(toolCallId, ctx.signal, ctx.tabId);
  if (choice.decision === 'timeout') {
    // Nobody answered: deny and say why, so the transcript explains the step that never ran.
    const note = t('No answer within {{minutes}} minutes, so the request was denied automatically.', {
      minutes: approvalTimeoutMinutes(),
    });
    ctx.setToolState(toolCallId, 'denied', { danger: note });
    return denied(undefined, note);
  }
  if (choice.decision === 'deny') {
    ctx.setToolState(toolCallId, 'denied', reason ? { danger: reason } : undefined);
    return denied(undefined, t('The user denied this operation.'));
  }
  // The card may edit a command before running it: the edited text is re-authorized (a dangerous
  // edit still gets the native confirmation), bound into the lease as the approved arguments, and
  // executed instead of the original.
  const edited = toolName === 'run_command' && choice.command !== undefined && choice.command !== input.command
    ? choice.command
    : undefined;
  if (edited !== undefined && !edited.trim()) {
    ctx.setToolState(toolCallId, 'denied');
    return denied(undefined, t('Enter a command before running it.'));
  }
  const approvedInput = edited !== undefined ? { ...input, command: edited } : input;
  if (edited !== undefined) {
    try {
      const recheck = await authorizer({
        tool: toolName,
        conversationId: ctx.tabId,
        command,
        args: approvedInput,
        shell: ctx.shellType ?? null,
        mode,
        reasonHint: t('This operation can change your system or reach your credentials.'),
        timeoutSecs: Math.round(approvalTimeoutMs() / 1000),
      });
      if (recheck.decision === 'deny') {
        const blocked = reasonText(recheck.reason) || reason;
        ctx.setToolState(toolCallId, 'denied', blocked ? { danger: blocked } : undefined);
        return denied(blocked, t('The operation was denied.'));
      }
    } catch (error) {
      // Fail closed: without an authorization for the edited text it must not run.
      console.warn('[permissions] Authorization unavailable:', error);
      return denied(undefined, t('Authorization is unavailable (the backend is offline); the operation was denied.'));
    }
  }
  if (ctx.signal?.aborted) return denied(undefined, t('Tool call cancelled.'));
  const approved = await approver(
    toolName,
    command,
    approvedInput,
    // A shape derived from the original arguments cannot cover an edited command; the narrowest
    // grant for an edit is this one call.
    edited !== undefined && choice.decision === 'shape' ? 'once' : choice.decision,
    ctx.tabId,
  ).catch((error: unknown) => {
    console.warn('[permissions] Could not record the approval:', error);
    return { decision: 'deny' } as ToolDecision;
  });
  if (ctx.signal?.aborted) return denied(undefined, t('Tool call cancelled.'));
  if (approved.decision !== 'allow') {
    ctx.setToolState(toolCallId, 'denied', reason ? { danger: reason } : undefined);
    return denied(reason, t('Approval did not complete; the operation was denied.'));
  }
  if (ctx.tabId && choice.decision !== 'once') grantedConversations.add(ctx.tabId);
  const runningExtra = {
    ...(reason ? { danger: reason } : {}),
    ...(edited !== undefined ? { input: approvedInput } : {}),
  };
  ctx.setToolState(toolCallId, 'running', Object.keys(runningExtra).length > 0 ? runningExtra : undefined);
  return {
    proceed: true,
    ...(approved.lease ? { lease: approved.lease } : {}),
    ...(edited !== undefined ? { command: edited } : {}),
  };
}
