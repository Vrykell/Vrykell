import type { DiskEntry, FsEntry, FileStat } from '@platform/api/types';
import { createLocalFileOps } from '@features/files/services/localFileOps';
import { createSshFileOps } from '@features/ssh/services/fileOps';

/**
 * fileOps — 文件操作对 UI 的唯一接口。
 *
 * 视图层（本地文件面板 / SSH 文件面板）只依赖这里的 `FileOps`：
 * 到底操作本地磁盘还是远端主机，由 `FileOpsTarget` 这一状态决定，
 * 真正的读写都交给后端命令（本地 `@platform/api/fs`、远程 SSH 命令）。
 */

/** 一条 from→to 映射（回退历史据此还原）。 */
export interface FileOpPair {
  from: string;
  to: string;
}

/** 批量操作结果：完成项 + 失败说明（部分失败不中断其余项）。 */
export interface FileOpOutcome {
  completed: FileOpPair[];
  errors: string[];
}

/** 目录列表结果；base 用于「目标自己解析出的起始目录」（远端主目录）。 */
export interface FileListResult {
  base: string | null;
  entries: FsEntry[];
}

/** 文件操作的执行目标：面板状态决定用哪套实现。 */
export type FileOpsTarget = { kind: 'local' } | { kind: 'ssh'; connectionId: string };

/** 文件操作接口：重名避让、可回退删除等语义由实现与后端保证。 */
export interface FileOps {
  /** Optional optimized traversal on the target's file channel. */
  search?(root: string, query: string, signal: AbortSignal): Promise<{ entries: FsEntry[]; truncated: boolean; skipped: number }>;
  /** Single-path metadata: the path bar detects files with it and the properties dialog reads it. */
  stat(path: string): Promise<FileStat>;
  /** 列出目录；dir 为 null 时用目标的默认起始目录（远端会返回解析后的 base）。 */
  list(dir: string | null): Promise<FileListResult>;
  /** 路径语义（本地与远端分隔符规则不同，统一由实现提供）。 */
  parentOf(path: string): string | null;
  /** 拆分为路径段（面包屑展示用）。 */
  segments(path: string): string[];
  /** 由路径段拼回完整路径。 */
  joinSegments(segments: string[]): string;
  join(dir: string, name: string): string;
  /** 新建空文件 / 文件夹，返回最终路径（重名自动加序号）。 */
  createFile(dir: string, name: string): Promise<string>;
  createDir(dir: string, name: string): Promise<string>;
  /** 重命名，返回最终路径（重名自动加序号）。 */
  rename(path: string, newName: string): Promise<string>;
  move(paths: string[], destDir: string): Promise<FileOpOutcome>;
  copy(paths: string[], destDir: string): Promise<FileOpOutcome>;
  /** Delete according to the target's undo preference; disabled undo returns empty staging paths. */
  stageDelete(paths: string[]): Promise<FileOpOutcome>;
  restoreStaged(pairs: FileOpPair[]): Promise<FileOpOutcome>;
  purgeStaged(paths: string[]): Promise<void>;
  /** 本地面板的起始目录（远端由 list 自行解析）。 */
  home?(): Promise<string>;
  /** 本地专有：磁盘视图（path 为 null 时展示）。 */
  disks?(): Promise<DiskEntry[]>;
  /** 远程专有：上传本地路径到目录（返回远端最终路径；未返回时不做回退记录）/ 下载到本地并返回本地路径。 */
  upload?(dir: string, localPath: string): Promise<string | void>;
  download?(path: string): Promise<string>;
}

/** 目标 → 实现：视图层唯一的实现选择点。 */
export function fileOpsFor(target: FileOpsTarget): FileOps {
  return target.kind === 'ssh' ? createSshFileOps(target.connectionId) : createLocalFileOps();
}

/**
 * 右键 / 拖放命中的行 → 实际落点目录：
 * 文件夹 → 自身；文件 → 同级目录；空白处 → 当前目录。
 * 两个面板共用这一份语义，避免各自维护一套「右键位置」判断。
 */
export function resolveTargetDir(
  entry: Pick<FsEntry, 'path' | 'is_dir'> | null | undefined,
  currentDir: string,
  parentOf: (path: string) => string | null,
): string {
  if (!entry) return currentDir;
  if (entry.is_dir) return entry.path;
  return parentOf(entry.path) ?? currentDir;
}

/** 新建文件 / 文件夹的默认名字（重名时后端自动加序号）。 */
export const DEFAULT_FILE_NAME = 'Untitled';
export const DEFAULT_DIR_NAME = 'NewFolder';
