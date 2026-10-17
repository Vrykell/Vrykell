/**
 * remarkStripStrayEmphasis — drops emphasis markers the model left unmatched.
 *
 * The markdown parser consumes balanced `**…**` pairs into strong nodes, so a run of two or more
 * asterisks left inside a text node is an unmatched marker. Rendered literally it looks like the
 * renderer leaked markup — a frequent shape in model output, where a paragraph opens `**` and
 * never closes it. Only text nodes are touched: code spans and code blocks keep their asterisks.
 */
interface MarkdownTextNode {
  type: string;
  value?: string;
  children?: MarkdownTextNode[];
}

const STRAY_ASTERISKS = /\*{2,}/g;

function stripStray(node: MarkdownTextNode): void {
  if (node.type === 'text') {
    if (typeof node.value === 'string') node.value = node.value.replace(STRAY_ASTERISKS, '');
    return;
  }
  if (node.type === 'inlineCode' || node.type === 'code') return;
  for (const child of node.children ?? []) stripStray(child);
}

export default function remarkStripStrayEmphasis() {
  return (tree: MarkdownTextNode): void => {
    stripStray(tree);
  };
}
