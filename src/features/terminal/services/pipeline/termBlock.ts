/** TermBlock — UI 可见的 block 投影（Spec §2）。内部字段不进此类型。 */

export type BlockStatus = 'pending' | 'executing' | 'done' | 'interrupted';

export interface TermBlock {
  id: string;
  command: string;
  cwd?: string;
  gitBranch?: string;
  status: BlockStatus;
  exitCode: number | null;
  startedAt: number | null;
  endedAt: number | null;
  wasLongRunning: boolean;
  /** Keep live output visible until its final parsed snapshot is ready. */
  snapshotPending?: boolean;
  /** 用户折叠/展开状态（UI 态，持久化进 blocks 表） */
  collapsed?: boolean;
  /** agent 发起的命令（投影标记，不落库）→ 块上渲染 ⚡ 徽标 */
  agent?: boolean;
  /** 带颜色的 HTML 快照（extractSnapshotFromBuffer 生成） */
  outputHtml: string;
  /** 纯文本输出（复制/AI 用） */
  outputText: string;
  /** 原始输出（≤256KB，供未来 resize 重排） */
  outputRaw: string;
  linesTruncated: number;
}
