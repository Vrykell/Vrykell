import type { TermBlock } from '@features/terminal/services/pipeline/termBlock';

/** Keep submitted empty blocks while omitting shell prompt placeholders. */
export function hasVisibleContent(block: TermBlock): boolean {
  return block.status === 'executing' || block.command !== '' || block.outputHtml !== '' || block.outputText !== ''
    || (block.status === 'done' && block.startedAt !== null);
}
