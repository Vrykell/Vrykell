import type { TermBlock } from '../services/pipeline/termBlock';

/** Reuse unchanged history entries so new output does not invalidate every completed block. */
export function projectBlocks(blocks: readonly TermBlock[], previous: TermBlock[], hasAgent: (id: string) => boolean): TermBlock[] {
  const oldById = new Map(previous.map(block => [block.id, block]));
  const next = blocks.map(block => {
    const old = oldById.get(block.id);
    const projected: TermBlock = {
      id: block.id, command: block.command, cwd: block.cwd, gitBranch: block.gitBranch,
      status: block.status, exitCode: block.exitCode, startedAt: block.startedAt, endedAt: block.endedAt,
      wasLongRunning: block.wasLongRunning, collapsed: old?.collapsed || undefined,
      snapshotPending: block.snapshotPending,
      agent: hasAgent(block.id) || undefined, outputHtml: block.outputHtml, outputText: block.outputText,
      outputRaw: block.outputRaw, linesTruncated: block.linesTruncated,
    };
    return old && (Object.keys(projected) as Array<keyof TermBlock>).every(key => old[key] === projected[key]) ? old : projected;
  });
  return previous.length === next.length && next.every((block, index) => block === previous[index]) ? previous : next;
}
