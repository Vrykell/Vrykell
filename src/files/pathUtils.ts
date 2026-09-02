/**
 * pathUtils — 文件面板路径处理的纯逻辑（跨平台分隔符 / 盘符根）。
 *
 * 约定：前端统一把路径归一化成正斜杠形式（`C:/Users/foo`、`/Users/foo`），
 * 传给后端的 `fs_list`（Windows 的 read_dir 同样接受 `/`）；后端返回的原生
 * 反斜杠路径在边界处用 `normPath` 归一化后再进状态。
 *
 * 与 React 无关，便于单测。
 */

/** 归一化分隔符为 `/`，去掉尾部斜杠；`/C:/Users`（OSC 7 的 Windows 盘符形式）→ `C:/Users`。
 *  文件系统根 `/` 必须保留（全剥尾斜杠会把根剥成空串，fs_list('') 会失败）。 */
export function normPath(p: string): string {
  let s = p.replace(/\\/g, '/').replace(/\/+$/, '');
  // 前导斜杠 + 盘符（/C:/Users）→ 盘符（C:/Users）
  s = s.replace(/^\/([a-zA-Z]):\//, '$1:/');
  s = s.replace(/\/+$/, '');
  if (s === '') s = '/'; // 根路径
  return s;
}

/** 拆成显示段：`C:/Users/foo` → ['C:', 'Users', 'foo']；`/Users` → ['Users']。 */
export function pathSegments(p: string): string[] {
  return normPath(p).split('/').filter(Boolean);
}

/** 段 → 路径：['C:'] → 'C:/'，['C:', 'Users'] → 'C:/Users'，['Users'] → '/Users'。 */
export function segmentsToPath(segs: string[]): string {
  if (segs.length === 0) return '';
  const first = segs[0]!;
  const isDrive = /^[a-zA-Z]:$/.test(first);
  if (isDrive) return first + '/' + segs.slice(1).join('/');
  return '/' + segs.join('/');
}

/** 是否 Windows 盘符根（`C:` / `C:/`）。 */
export function isDriveRoot(p: string): boolean {
  const segs = pathSegments(p);
  return segs.length === 1 && /^[a-zA-Z]:$/.test(segs[0]!);
}

/**
 * 上级目录路径；已在文件系统根 / 盘符根时返回 null（调用方应切到「盘符」视图）。
 */
export function parentOf(p: string): string | null {
  const segs = pathSegments(p);
  if (segs.length === 0) return null; // 已在文件系统根
  if (segs.length === 1) {
    // 盘符根（C:）→ 无上级；文件系统根的直接子目录（/Users）→ /
    return isDriveRoot(p) ? null : '/';
  }
  segs.pop();
  return segmentsToPath(segs);
}

/** 面包屑可见段：{ 段名, 该段对应的完整路径 }。 */
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
