/**
 * breadcrumb — 面包屑显示压缩（纯展示逻辑，本地与远程文件面板共用）。
 * 路径语义（分隔符 / 盘符根 / 上级）统一由 @platform/path 负责。
 */

export interface CompactCrumb {
  seg: string;
  full: string;
}

/**
 * 面包屑压缩：路径过长时省略高层级目录，只保留最深层级（文件路径可读性优先）。
 * 从最深段向前累计字符数，超过 maxChars 即停止；返回可见段与被省略的高层级数量。
 * toPath 负责把「前缀段数组」还原成完整路径（供点击导航）。
 */
export function compactPathSegments(
  segs: string[],
  toPath: (prefix: string[]) => string,
  maxChars = 26,
): { visible: CompactCrumb[]; hiddenCount: number } {
  const visible: CompactCrumb[] = [];
  let used = 0;
  for (let i = segs.length - 1; i >= 0; i--) {
    const cost = segs[i]!.length + 1; // +1 计入分隔符
    if (visible.length > 0 && used + cost > maxChars) break;
    used += cost;
    visible.unshift({ seg: segs[i]!, full: toPath(segs.slice(0, i + 1)) });
  }
  return { visible, hiddenCount: segs.length - visible.length };
}
