/** TermBlock — UI-visible projection of a block (spec §2). Internal fields never appear in this type. */

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
  /** Command started by the agent (projection flag, never persisted); renders a badge on the block */
  agent?: boolean;
  /** Colored HTML snapshot (produced by extractSnapshotFromBuffer) */
  outputHtml: string;
  /** Plain-text output (for copy and AI) */
  outputText: string;
  /** Raw output (≤256KB, kept for reflow on resize) */
  outputRaw: string;
  linesTruncated: number;
}
