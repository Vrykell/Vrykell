import type { FsEntry } from '@platform/api/types';

/**
 * fileTree — 文件面板树形展开的纯逻辑（排序 + 可见行拍平）。
 * 与 React 无关，便于单测。
 */

export interface VisibleRow {
  entry: FsEntry;
  /** 缩进深度，根级为 0 */
  depth: number;
  /** 目录是否处于展开状态（文件恒为 false） */
  expanded: boolean;
  /** 目录且已展开但子项尚未加载完成 */
  loading: boolean;
}

/** 目录在前，同类按名称排序（localeCompare） */
export function sortEntries(list: FsEntry[]): FsEntry[] {
  return [...list].sort((a, b) => {
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * 把根列表 + 展开状态 + 子项缓存拍平成渲染用的可见行。
 * 展开但缓存未到的目录标记 loading；缓存为空数组视为已加载的空目录。
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
      rows.push({
        entry,
        depth,
        expanded: isOpen,
        loading: isOpen && cache[entry.path] === undefined,
      });
      if (isOpen) {
        const children = cache[entry.path];
        // 防环：目录路径已在祖先链上（自引用 symlink、后端对任意路径返回相同
        // 列表等异常情况）时照常渲染该行，但不再递归，否则栈溢出
        if (children && !ancestors.has(entry.path)) {
          walk(children, depth + 1, new Set([...ancestors, entry.path]));
        }
      }
    }
  };
  walk(roots, 0, new Set());
  return rows;
}
