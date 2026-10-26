import { memo, useMemo } from 'react';
import { sanitizeOutputHtml } from '@utils/sanitizeHtml';
import { TERMINAL_FONT_FAMILY } from '@features/terminal/model/terminalFont';

export function plainText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Match decoded text nodes so entities and attributes remain intact. */
function highlightInHtml(html: string, query: string): string {
  if (!query || query.length < 2) return html;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const template = document.createElement('template');
  template.innerHTML = html;
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    const fragment = document.createDocumentFragment();
    let end = 0;
    for (const match of node.data.matchAll(new RegExp(escaped, 'gi'))) {
      fragment.append(node.data.slice(end, match.index));
      const mark = document.createElement('mark');
      mark.style.cssText = 'background:var(--search-highlight-bg);color:inherit;border-radius:2px';
      mark.textContent = match[0];
      fragment.append(mark);
      end = match.index + match[0].length;
    }
    if (end) {
      fragment.append(node.data.slice(end));
      node.replaceWith(fragment);
    }
  }
  return template.innerHTML;
}

interface Props {
  text: string;
  maxHeight?: number;
  /** Command blocks provide their own content inset. */
  flush?: boolean;
  highlight?: string;
  /** Explicitly opt into sanitized snapshot HTML. Never infer this from text. */
  isHtml?: boolean;
}

/** Render sanitized snapshots or encoded plain text, followed by safe text highlighting. */
export default memo(function BlockOutput({ text, maxHeight, flush = false, highlight, isHtml: isHtmlProp }: Props) {
  const isHtml = isHtmlProp === true;

  const content = useMemo(() => {
    if (isHtml) {
      // Persisted snapshots are untrusted regardless of their original producer.
      const safe = sanitizeOutputHtml(text);
      return highlight ? highlightInHtml(safe, highlight) : safe;
    }
    // Plain text fallback
    const escaped = plainText(text);
    return highlight ? highlightInHtml(`<span>${escaped}</span>`, highlight) : escaped;
  }, [text, highlight, isHtml]);

  return (
    <div
      data-selectable
      style={{
        maxHeight: maxHeight ? `${maxHeight}px` : undefined,
        overflowX: 'hidden',
        overflowY: maxHeight ? 'auto' : 'hidden',
        maxWidth: '100%',
        // Keep wrapped history geometry real when it moves into or out of the viewport.
        contain: 'layout style paint',
        background: flush ? 'transparent' : 'var(--xterm-bg)',
        color: 'var(--xterm-foreground)',
        // Use the same typography as live output.
        fontFamily: TERMINAL_FONT_FAMILY,
        fontWeight: 'var(--terminal-font-weight)',
        letterSpacing: 'var(--terminal-letter-spacing, 0px)',
        fontSize: 'var(--terminal-font-size)',
        // Keep snapshot rows tall enough for the glyph bounds used by live xterm.
        lineHeight: 'var(--terminal-row-height)',
        padding: flush ? 0 : '2px 8px 8px',
        // Preserve terminal spacing while fitting historical output to the current pane.
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
        overflowWrap: 'anywhere',
      }}
    >
      <div dangerouslySetInnerHTML={{ __html: content }} />
    </div>
  );
});
