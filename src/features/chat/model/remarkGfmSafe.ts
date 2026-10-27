/**
 * A lookbehind-free re-composition of the GFM remark plugin.
 *
 * Why: the email/URL literal detection of the GFM autolink utility builds regular
 * expressions with lookbehind assertions `(?<=…)`. Older WebKit-based system
 * WebViews reject that syntax and throw `SyntaxError: invalid group specifier
 * name` during construction, so any AI reply containing a bare link breaks
 * rendering (SafeMarkdown then falls back to plain text).
 *
 * The four GFM features (footnote, strikethrough, table, task list) are
 * re-assembled here with autolink-literal deliberately excluded: bare URLs in
 * replies render as plain text instead of links, in exchange for identical
 * behaviour on every platform and removing that whole class of crashes.
 *
 * The renderer only parses, never serializes, so only the syntax and mdast
 * extension arrays are registered; the serialization extensions are omitted.
 */
import { gfmFootnote } from 'micromark-extension-gfm-footnote';
import { gfmStrikethrough } from 'micromark-extension-gfm-strikethrough';
import { gfmTable } from 'micromark-extension-gfm-table';
import { gfmTaskListItem } from 'micromark-extension-gfm-task-list-item';
import { gfmFootnoteFromMarkdown } from 'mdast-util-gfm-footnote';
import { gfmStrikethroughFromMarkdown } from 'mdast-util-gfm-strikethrough';
import { gfmTableFromMarkdown } from 'mdast-util-gfm-table';
import { gfmTaskListItemFromMarkdown } from 'mdast-util-gfm-task-list-item';

interface ProcessorData {
  micromarkExtensions?: unknown[];
  fromMarkdownExtensions?: unknown[];
}

// `this` stays `unknown` to satisfy the plugin host's contravariant `this: Processor`
// constraint; the body narrows it to the data() shape actually used.
export default function remarkGfmSafe(this: unknown) {
  const data = (this as { data(): ProcessorData }).data();
  const micromarkExtensions = data.micromarkExtensions ?? (data.micromarkExtensions = []);
  const fromMarkdownExtensions =
    data.fromMarkdownExtensions ?? (data.fromMarkdownExtensions = []);

  micromarkExtensions.push(gfmFootnote(), gfmStrikethrough(), gfmTable(), gfmTaskListItem());
  fromMarkdownExtensions.push(
    gfmFootnoteFromMarkdown(),
    gfmStrikethroughFromMarkdown(),
    gfmTableFromMarkdown(),
    gfmTaskListItemFromMarkdown(),
  );
}
