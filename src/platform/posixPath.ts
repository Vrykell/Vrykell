/**
 * posixPath — path semantics for remote hosts (POSIX).
 *
 * Remote path rules do not depend on the host platform, so absolute/relative checks,
 * joining, parent and file-name resolution all live here; feature code must not join
 * separators itself or test `startsWith('/')`. The matching backend implementation is
 * `src-tauri/src/platform/path.rs` (a Windows host cannot use std::path for remote paths).
 */

/** Whether the path is absolute (POSIX: starts with `/`). */
export function isPosixAbsolute(path: string): boolean {
  return path.startsWith('/');
}

/** Normalizes: collapses repeated separators and `.`, resolves `..`, drops a trailing `/`; empty input becomes `/`. */
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

/** Joins a directory and a name (no `//` when the directory is the root or empty). */
export function joinPosix(dir: string, name: string): string {
  const base = normalizePosix(dir);
  return base === '/' ? `/${name}` : `${base}/${name}`;
}

/** Parent directory; null at the root. */
export function parentPosix(path: string): string | null {
  const normalized = normalizePosix(path);
  if (normalized === '/') return null;
  const cut = normalized.lastIndexOf('/');
  return cut <= 0 ? '/' : normalized.slice(0, cut);
}

/** File name (last segment); null at the root. */
export function fileNamePosix(path: string): string | null {
  const normalized = normalizePosix(path);
  if (normalized === '/') return null;
  return normalized.slice(normalized.lastIndexOf('/') + 1);
}

/** Last path segment for display; always has a value. */
export function baseNamePosix(path: string): string {
  return fileNamePosix(path) ?? path;
}
