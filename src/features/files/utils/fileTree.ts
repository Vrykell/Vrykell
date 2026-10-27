import type { FsEntry } from '@platform/api/types';

/**
 * fileTree — pure logic for the file panel's tree expansion (sorting + flattening visible rows).
 * Framework-agnostic and easy to unit test.
 */

export interface VisibleRow {
  entry: FsEntry;
  /** Indentation depth; root level is 0 */
  depth: number;
  /** Whether the directory is expanded (always false for files) */
  expanded: boolean;
  /** Directory that is expanded but whose children have not finished loading */
  loading: boolean;
  /** Directory that is loaded and has no children (known empty; no expander shown at the row start) */
  empty: boolean;
}

/** Directories first, then same-kind entries sorted by name (localeCompare) */
export function sortEntries(list: FsEntry[]): FsEntry[] {
  return [...list].sort((a, b) => {
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Flattens the root list, expansion state and child cache into visible rows for rendering.
 * An expanded directory whose cache has not arrived yet is marked loading; an empty cache array counts as a loaded empty directory (empty).
 */
export function flattenVisible(
  roots: FsEntry[],
  expanded: ReadonlySet<string>,
  cache: Readonly<Record<string, FsEntry[] | undefined>>,
): VisibleRow[] {
  const rows: VisibleRow[] = [];
  const walk = (list: FsEntry[], depth: number, ancestors: ReadonlySet<string>) => {
    for (const entry of sortEntries(list)) {
      const isOpen = entry.is_dir && expanded.has(entry.path);
      const children = cache[entry.path];
      rows.push({
        entry,
        depth,
        expanded: isOpen,
        loading: isOpen && children === undefined,
        empty: entry.is_dir && children !== undefined && children.length === 0,
      });
      if (isOpen) {
        // Cycle guard: when a directory path is already on the ancestor chain (self-referencing
        // symlink, backend returning the same listing for an arbitrary path), still render the row
        // but do not recurse, otherwise the stack overflows
        if (children && !ancestors.has(entry.path)) {
          walk(children, depth + 1, new Set([...ancestors, entry.path]));
        }
      }
    }
  };
  walk(roots, 0, new Set());
  return rows;
}
