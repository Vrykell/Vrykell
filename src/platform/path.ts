/**
 * platform/path — 本地文件系统路径语义的唯一出口（跨平台分隔符 / 盘符根 / 上级目录）。
 *
 * 约定：前端统一把路径归一化成正斜杠形式（`C:/Users/foo`、`/Users/foo`），传给后端的
 * `fs_list` 等命令（Windows 的 read_dir 同样接受 `/`）；后端返回的原生反斜杠路径在
 * `@platform/api/fs` 边界处归一化后再进业务状态。业务层不得再自行处理分隔符。
 *
 * - 文件系统根 `/` 必须保留（全剥尾斜杠会把根剥成空串，fs_list('') 会失败）。
 * - Windows 盘符根保留根斜杠 `C:/`：`C:` 是「该驱动器当前目录」而不是根。
 *
 * 与 React 无关，便于单测。
 */

/** 归一化分隔符为 `/`，去掉尾部斜杠；`/C:/Users`（OSC 7 的 Windows 盘符形式）→ `C:/Users`。 */
export function normPath(p: string): string {
  // 先处理前导斜杠 + 盘符（/C:/Users、/C:/、/C:），再收尾斜杠，避免盘符形式被提前破坏
  let s = p.replace(/\\/g, '/').replace(/^\/\/\?\/UNC\//i, '//').replace(/^\/\/\?\/([a-zA-Z]:\/)/, '$1')
    .replace(/^\/([a-zA-Z]):(\/|$)/, '$1:/');
  s = s.replace(/\/+$/, '');
  if (s === '') return '/'; // 根路径
  // 盘符根补齐根斜杠（C: → C:/），避免后端把它当成驱动器相对路径
  if (/^[a-zA-Z]:$/.test(s)) return `${s}/`;
  return s;
}

/** 拆成显示段：`C:/Users/foo` → ['C:', 'Users', 'foo']；`/Users` → ['Users']。 */
export function pathSegments(p: string): string[] {
  const path = normPath(p);
  const parts = path.split('/').filter(Boolean);
  if (path.startsWith('//') && parts.length) parts[0] = `//${parts[0]}`;
  return parts;
}

/** 段 → 路径：['C:'] → 'C:/'，['C:', 'Users'] → 'C:/Users'，['Users'] → '/Users'。 */
export function segmentsToPath(segs: string[]): string {
  if (segs.length === 0) return '';
  const first = segs[0]!;
  if (first.startsWith('//')) return segs.join('/');
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
  if (segs[0]?.startsWith('//') && segs.length <= 2) return null;
  if (segs.length === 1) {
    // 盘符根（C:）→ 无上级；文件系统根的直接子目录（/Users）→ /
    return isDriveRoot(p) ? null : '/';
  }
  segs.pop();
  return segmentsToPath(segs);
}
