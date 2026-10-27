/**
 * sanitizeHtml — sanitizes stored output HTML snapshots.
 *
 * The colored snapshot of a command block (outputHtml) is produced by
 * extractSnapshotFromBuffer (text is always escaped, styles are limited to palette/hex
 * colors), so its structure is safe by construction. Snapshots are persisted, though
 * (blocks.output_html), and rendered through dangerouslySetInnerHTML when a session is
 * restored: if the local database were tampered with, scripts, event handlers and
 * javascript: links would execute on render.
 *
 * Both the restore path (sessionManager.restore) and the render path (BlockOutput)
 * therefore sanitize: only the structure the snapshot generator emits is allowed —
 * <span> with a whitelisted style plus <br>; every other tag and attribute is dropped.
 */

const SAFE_STYLE_PROPS = new Set([
  'color',
  'background',
  'font-weight',
  'font-style',
  'text-decoration',
  'opacity',
  'display',
  'width',
  'letter-spacing',
]);

/** Style-value blacklist: url()/expression/javascript:/@import and similar are always rejected. */
const DANGEROUS_STYLE_VALUE = /url\s*\(|expression|javascript:|@import|behavior|-moz-binding|[\\"'{}]|\/\*/i;

function sanitizeStyleValue(style: string): string {
  const decls: string[] = [];
  for (const part of style.split(';')) {
    const idx = part.indexOf(':');
    if (idx <= 0) continue;
    const prop = part.slice(0, idx).trim().toLowerCase();
    const value = part.slice(idx + 1).trim();
    if (!SAFE_STYLE_PROPS.has(prop)) continue;
    if (prop === 'letter-spacing' && (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?em$/.test(value) || Math.abs(parseFloat(value)) > 0.2)) continue;
    if (DANGEROUS_STYLE_VALUE.test(value)) continue;
    decls.push(`${prop}:${value}`);
  }
  return decls.join(';');
}

/**
 * Sanitizes output HTML: the result contains only <span> (with a safe style) and <br>.
 * Tags outside the whitelist are replaced by their text; span attributes other than
 * style are removed.
 */
export function sanitizeOutputHtml(html: string): string {
  if (!html || !html.includes('<')) return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const body = doc.body;

  const walk = (node: Element) => {
    // Walk backwards so replaceWith does not shift the indices of earlier siblings
    for (let i = node.children.length - 1; i >= 0; i--) {
      const child = node.children[i]!;
      walk(child);
      const tag = child.tagName.toLowerCase();
      if (tag === 'br') {
        for (const attr of Array.from(child.attributes)) child.removeAttribute(attr.name);
        continue;
      }
      if (tag === 'span') {
        const style = child.getAttribute('style') ?? '';
        child.removeAttribute('style');
        const cleaned = sanitizeStyleValue(style);
        if (cleaned) child.setAttribute('style', cleaned);
        // Remove all remaining attributes (on*, id, class, href, ...)
        for (const attr of Array.from(child.attributes)) {
          if (attr.name !== 'style') child.removeAttribute(attr.name);
        }
        continue;
      }
      // Other tags: unwrap (drop the tag and its attributes, keep the sanitized children/text)
      child.replaceWith(...Array.from(child.childNodes));
    }
  };
  walk(body);
  return body.innerHTML;
}
