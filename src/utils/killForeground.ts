/**
 * killForeground — 结束 PTY 前台应用（结束按钮用）。
 *
 * 升级式逻辑（首次 SIGTERM、窗口内再点升级 SIGKILL）已下沉到 Rust 端
 * `pty_kill_foreground`，跨窗口重载保持升级状态；这里只负责调用并返回级别。
 */

import { invoke } from '@platform/diagnostics';

export type KillLevel = 'term' | 'kill';

/** 升级窗口（毫秒）——与 Rust 端 ESCALATE_WINDOW 一致，仅用于前端按钮状态复位 */
export const ESCALATE_WINDOW_MS = 3000;

/**
 * 结束指定 session 的前台应用，返回本次级别（term/kill）。
 * 后端拒绝（前台是 shell 本身、平台不支持等）时抛错，调用方负责提示。
 */
export async function killForeground(sessionId: string): Promise<KillLevel> {
  return invoke<KillLevel>('pty_kill_foreground', { id: sessionId });
}
