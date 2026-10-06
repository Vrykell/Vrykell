/**
 * sanitizeHtml — 输出 HTML 快照净化。
 *
 * 命令块的颜色快照（outputHtml）由 extractSnapshotFromBuffer 生成（文本一律
 * escapeHtml，样式仅限调色板/hex 颜色），结构上天然安全。但快照会**落库**
 * （blocks.output_html）并在会话恢复时经 dangerouslySetInnerHTML 渲染 ——
 * 本地 DB 若被篡改/注入，脚本、事件处理器、javascript: 链接都会在渲染时执行。
 *
 * 因此恢复（sessionManager.restore）与渲染（BlockOutput）两侧都做净化：
 * 只允许快照生成器产生的结构 —— <span>（白名单 style）+ <br>，其余标签与
 * 属性一律丢弃。
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

/** 样式值黑名单：url()/expression/javascript:/@import 等一律拒绝。 */
const DANGEROUS_STYLE_VALUE = /url\(|expression|javascript:|@import|behavior|-moz-binding/i;

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
 * 净化输出 HTML：返回只含 <span>（安全 style）与 <br> 的标记。
 * 非白名单标签替换为其纯文本；span 的 style 之外属性全部移除。
 */
export function sanitizeOutputHtml(html: string): string {
  if (!html || !html.includes('<')) return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const body = doc.body;

  const walk = (node: Element) => {
    // 自后向前遍历：replaceWith 不影响前面兄弟节点的索引
    for (let i = node.children.length - 1; i >= 0; i--) {
      const child = node.children[i]!;
      walk(child);
      const tag = child.tagName.toLowerCase();
      if (tag === 'br') {
        child.removeAttribute('style');
        continue;
      }
      if (tag === 'span') {
        const style = child.getAttribute('style') ?? '';
        child.removeAttribute('style');
        const cleaned = sanitizeStyleValue(style);
        if (cleaned) child.setAttribute('style', cleaned);
        // 其余属性（on*、id、class、href…）全部移除
        for (const attr of Array.from(child.attributes)) {
          if (attr.name !== 'style') child.removeAttribute(attr.name);
        }
        continue;
      }
      // 其它标签：解包（丢弃标签与属性，保留已净化的子节点/文本）
      child.replaceWith(...Array.from(child.childNodes));
    }
  };
  walk(body);
  return body.innerHTML;
}
