import { useMemo } from 'react';

export function plainText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 在 HTML 中高亮匹配文本（跳过标签内部） */
function highlightInHtml(html: string, query: string): string {
  if (!query || query.length < 2) return html;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return html.replace(
    new RegExp(`(>)([^<]*?)(${escaped})([^<]*?)(<)`, 'gi'),
    (_, a, before, match, after, b) =>
      `${a}${before}<mark style="background:var(--search-highlight-bg);color:inherit;border-radius:2px">${match}</mark>${after}${b}`,
  );
}

interface Props {
  text: string;
  maxHeight?: number;
  highlight?: string;
  /** 显式声明 text 为预渲染 HTML（新管线 outputHtml 恒为 HTML，可能不含 <span，靠嗅探会误判） */
  isHtml?: boolean;
}

/**
 * BlockOutput — 渲染历史块的输出内容。
 *
 * 支持两种输入模式：
 *   1. 预渲染的 styled HTML（isHtml=true，由 extractSnapshotFromBuffer 生成）
 *      → 直接 innerHTML 渲染，版式和颜色完全正确
 *   2. 纯文本（outputText）
 *      → HTML 转义后渲染
 *
 * 安全约束：仅当调用方显式传入 isHtml=true 时才走 dangerouslySetInnerHTML。
 * 严禁内容嗅探（如 text.includes('<span')）——历史输出是不可信文本，
 * 用户 cat 过的 HTML 会经嗅探被误判为 HTML 直接注入执行（存储型 XSS）。
 */
export default function BlockOutput({ text, maxHeight, highlight, isHtml: isHtmlProp }: Props) {
  const isHtml = isHtmlProp === true;

  const content = useMemo(() => {
    if (isHtml) {
      return highlight ? highlightInHtml(text, highlight) : text;
    }
    // Plain text fallback
    const escaped = plainText(text);
    return highlight ? highlightInHtml(`<span>${escaped}</span>`, highlight) : escaped;
  }, [text, highlight, isHtml]);

  return (
    <div
      style={{
        maxHeight: maxHeight ? `${maxHeight}px` : undefined,
        overflow: maxHeight ? 'auto' : undefined,
        // 与 xterm.js 实时渲染保持一致的字体参数
        fontFamily: 'Menlo, Monaco, "Cascadia Code", "JetBrains Mono", "Noto Sans CJK SC", "PingFang SC", "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", monospace',
        fontSize: 14,
        lineHeight: 1.4,
        padding: '2px 8px 8px',
        // isHtml 快照已按网格 cols 用 <br> 预分行（每行 ≤ cols 字符）。
        // 卡片内容盒比 cols×ch 略窄（实测 153.6 vs 154），pre-wrap 会在网格行
        // 中间软换行撕裂 TUI 框线（claude 等满宽输出排版错乱）——
        // 网格快照禁止软换行，放不下的行横向滚动（同真实终端的裁剪语义）。
        whiteSpace: isHtml ? 'pre' : 'pre-wrap',
        wordBreak: isHtml ? undefined : 'break-all',
        overflowX: isHtml ? 'auto' : undefined,
      }}
    >
      {/* 内层 div 承载 HTML：React 不允许 children 与 dangerouslySetInnerHTML 并存 */}
      {isHtml ? <div dangerouslySetInnerHTML={{ __html: content }} /> : content}
    </div>
  );
}
