/**
 * inputVisibility — 输入框可见性状态机（对应文档 §7）。
 *
 * 决定输入框在六种条件下是否应该显示。
 */

export interface InputVisibilityContext {
  isReadOnly: boolean;
  isAltScreenActive: boolean;
  isLongRunning: boolean;
  isAgentInControl: boolean;
  isAgentTaggedIn: boolean;
}

/**
 * 判断输入框是否可见。
 *
 * 条件优先级（§7 简化版，对应 is_input_box_visible() 的 10+ 条件）：
 *   1. 只读 → 隐藏
 *   2. 全屏 TUI 活跃 → 隐藏
 *   3. 长运行命令（非 agent 控制/tagged）→ 隐藏
 *   4. 默认 → 可见
 *
 * 暂不实现：agent 控制、共享会话、对话墓碑、AI block 等待确认。
 */
export function isInputBoxVisible(ctx: InputVisibilityContext): boolean {
  // 1. 只读模式
  if (ctx.isReadOnly) return false;

  // 2. 全屏 TUI 活跃
  if (ctx.isAltScreenActive) return false;

  // 3. 长运行命令 — 默认隐藏（除非 agent 介入）
  if (ctx.isLongRunning && !ctx.isAgentInControl && !ctx.isAgentTaggedIn) {
    return false;
  }

  // 4. 默认可见
  return true;
}

/**
 * 长运行命令时输入框隐藏的提示文本。
 */
export function getLongRunningHint(command: string): string {
  const label = command.length > 40 ? command.slice(0, 37) + '...' : command;
  return `${label} 运行中 · 按 End 回到输入栏`;
}
