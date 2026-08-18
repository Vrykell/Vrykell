/**
 * pathUtils — 文件面板路径处理的纯逻辑（跨平台分隔符 / 盘符根）。
 *
 * 约定：前端统一把路径归一化成正斜杠形式（`C:/Users/foo`、`/Users/foo`），
 * 传给后端的 `fs_list`（Windows 的 read_dir 同样接受 `/`）；后端返回的原生
 * 反斜杠路径在边界处用 `normPath` 归一化后再进状态。
 *
 * 与 React 无关，便于单测。
 */

/** 归一化分隔符为 `/`，去掉尾部斜杠；`/C:/Users`（OSC 7 的 Windows 盘符形式）→ `C:/Users`。 */
export function normPath(p: string): string {
  let s = p.replace(/\\/g, '/').replace(/\/+$/, '');
  // 前导斜杠 + 盘符（/C:/Users）→ 盘符（C:/Users）
  s = s.replace(/^\/([a-zA-Z]):\//, '$1:/');
  return s.replace(/\/+$/, '');
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
