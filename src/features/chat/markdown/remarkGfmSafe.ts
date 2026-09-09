/**
 * remarkGfmSafe — remark-gfm 的无 lookbehind 重组版。
 *
 * 背景：mdast-util-gfm-autolink-literal 的邮箱/URL 识别会构造带 lookbehind
 * 断言 `(?<=…)` 的正则，旧版 WebKit（Safari < 16.4，macOS 12 系统 WebView）
 * 不支持该语法，构造即抛 `SyntaxError: invalid group specifier name`，
 * 任何含裸链接的 AI 回复都会击穿渲染（SafeMarkdown 降级为纯文本）。
 *
 * 这里按 remark-gfm 的原装配方重组 GFM 四个功能（脚注/删除线/表格/任务列表），
 * 唯独剔除 autolink-literal —— 代价是回复里的裸 URL 渲染为纯文本而非链接，
 * 换来所有平台行为一致、整类崩溃根除。
 *
 * react-markdown 只走「解析」方向，故只注册 micromarkExtensions（语法）与
 * fromMarkdownExtensions（mdast），省去 toMarkdown / html 序列化扩展。
 */

import { gfmFootnoteFromMarkdown } from 'mdast-util-gfm-footnote';
import { gfmStrikethroughFromMarkdown } from 'mdast-util-gfm-strikethrough';
import { gfmTableFromMarkdown } from 'mdast-util-gfm-table';
import { gfmTaskListItemFromMarkdown } from 'mdast-util-gfm-task-list-item';
import { gfmFootnote } from 'micromark-extension-gfm-footnote';
import { gfmStrikethrough } from 'micromark-extension-gfm-strikethrough';
import { gfmTable } from 'micromark-extension-gfm-table';
import { gfmTaskListItem } from 'micromark-extension-gfm-task-list-item';

interface ProcessorData {
  micromarkExtensions?: unknown[];
  fromMarkdownExtensions?: unknown[];
}

// this 标为 unknown 以兼容 unified Plugin 的 this: Processor 约束（逆变），
// 函数体内再收窄到实际用到的 data() 形状。
export default function remarkGfmSafe(this: unknown) {
  const data = (this as { data(): ProcessorData }).data();
  const micromarkExtensions = data.micromarkExtensions ?? (data.micromarkExtensions = []);
  const fromMarkdownExtensions = data.fromMarkdownExtensions ?? (data.fromMarkdownExtensions = []);

  micromarkExtensions.push(gfmFootnote(), gfmStrikethrough(), gfmTable(), gfmTaskListItem());
  fromMarkdownExtensions.push(
    gfmFootnoteFromMarkdown(),
    gfmStrikethroughFromMarkdown(),
    gfmTableFromMarkdown(),
    gfmTaskListItemFromMarkdown(),
  );
}
