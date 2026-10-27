/**
 * platform/path — the single source of local filesystem path semantics
 * (cross-platform separators, drive roots, parent directories).
 *
 * Convention: the front end normalizes every path to forward slashes
 * (`C:/Users/foo`, `/Users/foo`) before passing it to backend commands such as
 * `fs_list` (the Windows directory listing accepts `/` too); native backslash paths
 * returned by the backend are normalized at the `@platform/api/fs` boundary before
 * entering feature state. Feature code must not handle separators itself.
 *
 * - The filesystem root `/` must be preserved (stripping all trailing slashes would
 *   turn it into an empty string and fs_list('') would fail).
 * - A Windows drive root keeps its root slash `C:/`: `C:` means "the current directory
 *   of that drive", not the root.
 *
 * Free of UI dependencies so it stays unit-testable.
 */

/** Normalizes separators to `/` and strips trailing slashes; `/C:/Users` (the Windows drive form of OSC 7) → `C:/Users`. */
export function normPath(p: string): string {
  // Handle a leading slash plus drive (/C:/Users, /C:/, /C:) before trimming trailing
  // slashes, so the drive form is not broken early
  let s = p.replace(/\\/g, '/').replace(/^\/\/\?\/UNC\//i, '//').replace(/^\/\/\?\/([a-zA-Z]:\/)/, '$1')
    .replace(/^\/([a-zA-Z]):(\/|$)/, '$1:/');
  s = s.replace(/\/+$/, '');
  if (s === '') return '/'; // root path
  // Give a bare drive its root slash (C: → C:/) so the backend does not treat it as a drive-relative path
  if (/^[a-zA-Z]:$/.test(s)) return `${s}/`;
  return s;
}

/** Display segments: `C:/Users/foo` → ['C:', 'Users', 'foo']; `/Users` → ['Users']. */
export function pathSegments(p: string): string[] {
  const path = normPath(p);
  const parts = path.split('/').filter(Boolean);
  if (path.startsWith('//') && parts.length) parts[0] = `//${parts[0]}`;
  return parts;
}

/** Segments → path: ['C:'] → 'C:/', ['C:', 'Users'] → 'C:/Users', ['Users'] → '/Users'. */
export function segmentsToPath(segs: string[]): string {
  if (segs.length === 0) return '';
  const first = segs[0]!;
  if (first.startsWith('//')) return segs.join('/');
  const isDrive = /^[a-zA-Z]:$/.test(first);
  if (isDrive) return first + '/' + segs.slice(1).join('/');
  return '/' + segs.join('/');
}

/** Whether this is a Windows drive root (`C:` / `C:/`). */
export function isDriveRoot(p: string): boolean {
  const segs = pathSegments(p);
  return segs.length === 1 && /^[a-zA-Z]:$/.test(segs[0]!);
}

/**
 * Parent directory path; null at the filesystem root or drive root (the caller should
 * switch to the drive view).
 */
export function parentOf(p: string): string | null {
  const segs = pathSegments(p);
  if (segs.length === 0) return null; // already at the filesystem root
  if (segs[0]?.startsWith('//') && segs.length <= 2) return null;
  if (segs.length === 1) {
    // Drive root (C:) → no parent; a direct child of the filesystem root (/Users) → /
    return isDriveRoot(p) ? null : '/';
  }
  segs.pop();
  return segmentsToPath(segs);
}
