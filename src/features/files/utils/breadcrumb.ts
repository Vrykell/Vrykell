/**
 * breadcrumb — breadcrumb display compaction (pure presentation logic shared by the local and remote file panels).
 * Path semantics (separator / drive root / parent) are handled by @platform/path.
 */

export interface CompactCrumb {
  seg: string;
  full: string;
}

/**
 * Breadcrumb compaction: when the path is too long, drop the higher-level directories and keep only the deepest levels (file path readability first).
 * Accumulates characters from the deepest segment backwards and stops once maxChars is exceeded; returns the visible segments and the number of hidden higher-level directories.
 * toPath restores a prefix segment array into a full path (for click navigation).
 */
export function compactPathSegments(
  segs: string[],
  toPath: (prefix: string[]) => string,
  maxChars = 26,
): { visible: CompactCrumb[]; hiddenCount: number } {
  const visible: CompactCrumb[] = [];
  let used = 0;
  for (let i = segs.length - 1; i >= 0; i--) {
    const cost = segs[i]!.length + 1; // +1 counts the separator
    if (visible.length > 0 && used + cost > maxChars) break;
    used += cost;
    visible.unshift({ seg: segs[i]!, full: toPath(segs.slice(0, i + 1)) });
  }
  return { visible, hiddenCount: segs.length - visible.length };
}
