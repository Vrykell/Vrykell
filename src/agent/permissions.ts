/**
 * permissions — AI 权限管理（M3）。
 *
 * 三层判定（按序）：
 *   1. 持久化默认级别（levels，设置页可改）：allow 直放行 / ask 弹审批 / deny 不注册
 *   2. 会话授权（sessionGrants，内存，重启失效）：审批卡「本会话允许」写入
 *   3. 危险命令启发式（仅 run_command）：无视 1/2 逐次询问
 *
 * 审批桥：工具 execute 里 gate() 挂起等 Promise；审批卡按钮调
 * resolveApproval() 落决定。stop/abort 必须走 denyAllPending() 兜底，
 * 否则 execute 永远悬挂（AI SDK 步进卡死）。
 *
 * 视觉契约：gate 通过 ctx.setToolState 把 ToolRun 打到 approval-pending
 * （静态暖色环）→ 决定后回 running（脉冲）或 denied（灰环）；denied 的
 * 结构化结果带 denied:true 哨兵，agentStream 据此保持灰环不被 tool-result
 * 覆盖成 done。
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ToolRunState } from './messageParts';

export type ToolLevel = 'allow' | 'ask' | 'deny';
export type ApprovalDecision = 'once' | 'session' | 'deny';

/** 工具结果统一形状（与 tools/* 的结构化约定一致） */
export interface GateResult {
  ok: boolean;
  denied?: boolean;
  error?: string;
}

export interface ToolContext {
  signal?: AbortSignal;
  /** 会话 id（= 工作区 tabId），会话授权的命名空间；缺省时禁用会话授权 */
  tabId?: string;
  /** 审批状态回写（agentStream 接到后 upsert ToolRun） */
  setToolState?: (toolCallId: string, state: ToolRunState, extra?: { danger?: string }) => void;
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
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

const DEFAULT_LEVELS: Record<ToolName, ToolLevel> = {
  run_command: 'ask',
  read_file: 'allow',
  write_file: 'ask',
  edit_file: 'ask',
  list_dir: 'allow',
  search_files: 'allow',
  web_search: 'allow',
};

interface PermissionsState {
  levels: Record<string, ToolLevel>;
  /** 快捷权限模式（状态栏一键切换）：
   *  standard = 按 levels 逐工具判定（设置页可调）；
   *  strict   = 全部工具逐次询问；
   *  relaxed  = 全部放行（危险命令启发式仍逐次询问，不受放行影响）。
   *  在设置页单独调整某工具级别会回落到 standard。 */
  mode: 'standard' | 'strict' | 'relaxed';
  setLevel: (tool: ToolName, level: ToolLevel) => void;
  setMode: (mode: 'standard' | 'strict' | 'relaxed') => void;
}

export const usePermissions = create<PermissionsState>()(
  persist(
    (set) => ({
      levels: { ...DEFAULT_LEVELS },
      mode: 'standard',
      setLevel: (tool, level) =>
        set((s) => ({ levels: { ...s.levels, [tool]: level }, mode: 'standard' })),
      setMode: (mode) => set({ mode }),
    }),
    { name: 'vrykell-permissions' },
  ),
);

export function levelOf(tool: string): ToolLevel {
  const s = usePermissions.getState();
  if (s.mode === 'strict') return 'ask';
  if (s.mode === 'relaxed') return 'allow';
  return s.levels[tool] ?? 'ask';
}

// ── 会话授权（内存，重启即失效） ──

const sessionGrants = new Map<string, Set<string>>();

export function hasSessionGrant(tabId: string | undefined, tool: string): boolean {
  return !!tabId && (sessionGrants.get(tabId)?.has(tool) ?? false);
}

function grantSession(tabId: string, tool: string) {
  let set = sessionGrants.get(tabId);
  if (!set) sessionGrants.set(tabId, (set = new Set()));
  set.add(tool);
}

/** 设置页「清空本会话授权」：不传 tabId 清空全部 */
export function clearSessionGrants(tabId?: string) {
  if (tabId) sessionGrants.delete(tabId);
  else sessionGrants.clear();
}

// ── 审批桥 ──

const pending = new Map<string, (d: ApprovalDecision) => void>();

function requestApproval(toolCallId: string): Promise<ApprovalDecision> {
  return new Promise((resolve) => pending.set(toolCallId, resolve));
}

/** 审批卡按钮入口。unknown toolCallId 静默忽略（可能已被 stop 兜底清掉） */
export function resolveApproval(toolCallId: string, decision: ApprovalDecision) {
  pending.get(toolCallId)?.(decision);
  pending.delete(toolCallId);
}

/** 中止/断流时兜底：所有挂起审批一律按拒绝放行，防 execute 悬挂 */
export function denyAllPending() {
  for (const resolve of pending.values()) resolve('deny');
  pending.clear();
}

// ── 危险命令启发式（表驱动；命中即逐次询问，无视任何授权） ──

const DANGEROUS: Array<[RegExp, string]> = [
  // 更具体的规则在前（curl|sudo bash 应报「管道执行」而非「sudo」）
  [/\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba|z|fi)?sh\b/, '下载并管道执行远程脚本'],
  [/\brm\s+(-[a-zA-Z]*[rf][a-zA-Z]*\s|--(recursive|force)\b)/, '递归/强制删除文件'],
  [/\bsudo\b/, 'sudo 提权操作'],
  [/\b(dd|mkfs|fdisk|diskutil)\s/, '磁盘级操作'],
  [/\bgit\s+push\b[^&|;]*(\s-f\b|--force)/, 'git 强制推送（会覆盖远端历史）'],
  [/\bgit\s+(reset\s+--hard|clean\s+-[a-zA-Z]*f)/, 'git 丢弃工作区改动（不可恢复）'],
  [/\b(pkill|killall)\b/, '按名字批量杀进程（可能误伤同名进程）'],
  [/\bkill\s+-(9|KILL)\b/, '强杀进程（SIGKILL，进程无清理机会）'],
  [/\b(shutdown|reboot|halt|poweroff)\b/, '关机/重启系统'],
  [/\bchmod\s+(-[a-zA-Z]*R[a-zA-Z]*\s+)?777\b/, '放开全员读写执行权限'],
  [/>\s*\/dev\/(sd|nvme|disk)/, '直写磁盘设备'],
  [/:\(\)\s*\{.*\|.*&.*\}\s*;?\s*:/, 'fork 炸弹'],
];

/** 命中返回中文原因（审批卡展示），未命中返回 null */
export function dangerousCommandReason(command: string): string | null {
  for (const [re, reason] of DANGEROUS) {
    if (re.test(command)) return reason;
  }
  return null;
}

// ── 门控 ──

type GateOutcome = { proceed: true } | { proceed: false; result: GateResult };

/**
 * 工具 execute 的第一行。返回 proceed:false 时直接把 result 作为工具结果返回
 * （带 denied 哨兵，agentStream 据此刻成 denied 灰环）。
 */
export async function gate(
  toolName: ToolName,
  input: Record<string, unknown>,
  toolCallId: string | undefined,
  ctx: ToolContext,
): Promise<GateOutcome> {
  const level = levelOf(toolName);
  if (level === 'deny') {
    return {
      proceed: false,
      result: { ok: false, denied: true, error: `工具 ${toolName} 已在权限设置中被禁用` },
    };
  }
  // 危险命令无视授权逐次询问（ask 之前的短路对 danger 不生效）
  const danger =
    toolName === 'run_command' ? dangerousCommandReason(String(input.command ?? '')) : null;
  if (!danger && (level === 'allow' || hasSessionGrant(ctx.tabId, toolName))) {
    return { proceed: true };
  }
  // ask：挂起等审批。无 setToolState/tabId 说明不在交互上下文（如测试），按拒绝处理
  if (!toolCallId || !ctx.setToolState || !ctx.tabId) {
    return {
      proceed: false,
      result: { ok: false, denied: true, error: '当前上下文无法发起审批，操作被拒绝' },
    };
  }
  ctx.setToolState(toolCallId, 'approval-pending', danger ? { danger } : undefined);
  const decision = await requestApproval(toolCallId);
  if (decision === 'deny') {
    ctx.setToolState(toolCallId, 'denied', danger ? { danger } : undefined);
    return {
      proceed: false,
      result: { ok: false, denied: true, error: '用户拒绝了本次操作' },
    };
  }
  if (decision === 'session') grantSession(ctx.tabId, toolName);
  ctx.setToolState(toolCallId, 'running', danger ? { danger } : undefined);
  return { proceed: true };
}
