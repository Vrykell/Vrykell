/**
 * agentControl — agent 正在控制的 pane 集合（引用计数）。
 *
 * 接通 inputVisibility 的 isAgentInControl 预留位：agent 通过 run_command
 * 在 pane 里跑命令期间，该 pane 的输入栏保持可见（长命令不隐藏）。
 * 引用计数防止嵌套/并发工具调用提前释放。
 */

const counts = new Map<string, number>();
const listeners = new Set<() => void>();

/** agent 发起的命令块 id 注册表（⚡ 投影标记的真源）。
 *  块流 onBlocksChanged 会整体替换数组（projectBlock 重建），updateBlock
 *  打的补丁会被冲掉，所以标记持久在这里，投影时按 id 查回。 */
const markedBlocks = new Set<string>();

/** toolCallId → blockId：AiBlock 把命令输出块内嵌进回答（挂在 run_command
 *  节点下）时按 toolCallId 反查活块。会话级内存映射，重启后丢失 ——
 *  内嵌卡片降级为渲染工具结果里捕获的输出文本。 */
const toolCallBlocks = new Map<string, string>();

function emit() {
  for (const fn of listeners) fn();
}

export const agentControl = {
  /** 进入控制（可嵌套；每次 acquire 必须配对 release） */
  acquire(paneId: string): void {
    counts.set(paneId, (counts.get(paneId) ?? 0) + 1);
    emit();
  },
  release(paneId: string): void {
    const n = (counts.get(paneId) ?? 0) - 1;
    if (n <= 0) counts.delete(paneId);
    else counts.set(paneId, n);
    emit();
  },
  isControlled(paneId: string): boolean {
    return (counts.get(paneId) ?? 0) > 0;
  },
  /** UI 订阅（useSyncExternalStore 用） */
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  /** 登记 agent 发起的命令块（⚡ 徽标真源，会话级不落库） */
  markBlock(blockId: string): void {
    markedBlocks.add(blockId);
  },
  hasBlock(blockId: string): boolean {
    return markedBlocks.has(blockId);
  },
  /** 记录工具调用 → 命令块映射（内嵌渲染用） */
  linkToolCall(toolCallId: string, blockId: string): void {
    toolCallBlocks.set(toolCallId, blockId);
  },
  blockForToolCall(toolCallId: string): string | undefined {
    return toolCallBlocks.get(toolCallId);
  },
};
