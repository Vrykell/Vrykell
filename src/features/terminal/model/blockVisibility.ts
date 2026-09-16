import type { TermBlock } from '@features/terminal/services/pipeline/termBlock';

/** 判断块是否有值得渲染的可见内容。 */
export function hasVisibleContent(block: TermBlock): boolean {
  return block.status === 'executing' || block.command !== '' || block.outputHtml !== '' || block.outputText !== '';
}
