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

/** 工具结果统一形状（与 tools/* 的结构化约定一致） */
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
  /** 会话 id（= 工作区 tabId），审批卡的落点 */
  tabId?: string;
  /** 审批状态回写（agentStream 接到后 upsert ToolRun）；shape 用于卡片上的「本会话允许这一种」，input 携带编辑后的命令 */
  setToolState?: (toolCallId: string, state: ToolRunState, extra?: { danger?: string; shape?: string; input?: Record<string, unknown> }) => void;
}

/** 全部受管工具（设置页表格也用它渲染，新增工具别漏） */
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
  /** 后端策略回填（启动与设置页变更后） */
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

// ── 审批桥 ──

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

/** 审批卡按钮入口。unknown toolCallId 静默忽略（可能已被 stop 兜底清掉） */
export function resolveApproval(toolCallId: string, decision: ApprovalDecision, command?: string) {
  pending.get(toolCallId)?.resolve({ decision, command });
  pending.delete(toolCallId);
}

/** 中止/断流时兜底：所有挂起审批一律按拒绝放行，防 execute 悬挂 */
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
 * 未信任技能的访问确认：agent 要读/写/运行某个未信任技能的文件或脚本时调用。
 * 复用审批卡；允许则放行（由调用方持久化信任），拒绝则阻断。
 */
export async function ensureTrustedSkill(
  skillName: string,
  toolCallId: string | undefined,
  ctx: ToolContext,
): Promise<{ proceed: boolean; error?: string }> {
  if (!toolCallId || !ctx.setToolState || !ctx.tabId) {
    return {
      proceed: false,
      error: `当前上下文无法确认信任，已拒绝访问未信任技能「${skillName}」`,
    };
  }
  ctx.setToolState(toolCallId, 'approval-pending', {
    danger: `信任技能「${skillName}」后可访问其文件与脚本`,
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
    return { proceed: false, error: `未信任技能「${skillName}」，已拒绝访问` };
  }
  ctx.setToolState(toolCallId, 'running');
  return { proceed: true };
}

/**
 * 工具执行前检查：文本/路径若引用未信任技能，先弹「信任此技能」确认；
 * 通过则持久化信任并放行，否则阻断。
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

// ── 授权入口（Rust 决定） ──

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
 * 工具 execute 的第一行。`command` 是受门控的后端命令名（read_file_text / fs_search …），
 * 租约与参数一并绑定到它；返回 proceed:false 时直接把 result 作为工具结果返回
 * （带 denied 哨兵，agentStream 据此刻成 denied 灰环）。
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
    return denied(undefined, '无法获取授权（后端不可用），操作已拒绝');
  }

  if (ctx.signal?.aborted) return denied(undefined, t('Tool call cancelled.'));
  const reason = reasonText(decision.reason);
  if (decision.decision === 'deny') {
    if (toolCallId) ctx.setToolState?.(toolCallId, 'denied', reason ? { danger: reason } : undefined);
    return denied(reason, '操作被拒绝');
  }
  if (decision.decision === 'allow') {
    return { proceed: true, ...(decision.lease ? { lease: decision.lease } : {}) };
  }
  // ask：挂起等审批。无 setToolState/tabId 说明不在交互上下文（如测试），按拒绝处理
  if (!toolCallId || !ctx.setToolState || !ctx.tabId) {
    return denied(undefined, '当前上下文无法发起审批，操作被拒绝');
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
    return denied(undefined, '用户拒绝了本次操作');
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
        return denied(blocked, '操作被拒绝');
      }
    } catch (error) {
      // Fail closed: without an authorization for the edited text it must not run.
      console.warn('[permissions] Authorization unavailable:', error);
      return denied(undefined, '无法获取授权（后端不可用），操作已拒绝');
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
    return denied(reason, '审批未能完成，操作已拒绝');
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
