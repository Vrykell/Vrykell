/**
 * posixPath — 远端主机（POSIX）路径语义。
 *
 * 远端路径规则与宿主平台无关，因此「绝对/相对判断、拼接、取父目录、取文件名」都收口在这里，
 * 业务层不要自己拼接分隔符或判断 `startsWith('/')`。对应的 Rust 实现见
 * `src-tauri/src/platform/path.rs`（Windows 宿主同样不能用 std::path 处理远端路径）。
 */

/** 是否绝对路径（POSIX：以 `/` 开头）。 */
export function isPosixAbsolute(path: string): boolean {
  return path.startsWith('/');
}

/** 规范化：折叠重复分隔符与 `.`、处理 `..`、去掉结尾 `/`；空值归一为 `/`。 */
export function normalizePosix(path: string): string {
  if (!path) return '/';
  const parts: string[] = [];
  for (const segment of path.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  return `/${parts.join('/')}`;
}

/** 拼接目录与名称（目录为根或空时不会产生 `//`）。 */
export function joinPosix(dir: string, name: string): string {
  const base = normalizePosix(dir);
  return base === '/' ? `/${name}` : `${base}/${name}`;
}

/** 父目录；根目录返回 null。 */
export function parentPosix(path: string): string | null {
  const normalized = normalizePosix(path);
  if (normalized === '/') return null;
  const cut = normalized.lastIndexOf('/');
  return cut <= 0 ? '/' : normalized.slice(0, cut);
}

/** 文件名（末段）；根目录返回 null。 */
export function fileNamePosix(path: string): string | null {
  const normalized = normalizePosix(path);
  if (normalized === '/') return null;
  return normalized.slice(normalized.lastIndexOf('/') + 1);
}

/** 路径末段名称（用于展示，始终有值）。 */
export function baseNamePosix(path: string): string {
  return fileNamePosix(path) ?? path;
}
