import type { DiskEntry, FsEntry, FileStat } from '@platform/api/types';
import { createLocalFileOps } from '@features/files/services/localFileOps';
import { createSshFileOps } from '@features/ssh/services/fileOps';

/**
 * fileOps — the single interface between the UI and file operations.
 *
 * View code (local file panel / SSH file panel) depends only on `FileOps`:
 * the `FileOpsTarget` state decides whether the target is local disk or a remote host,
 * and all reads and writes are delegated to backend commands (local `@platform/api/fs`, remote SSH commands).
 */

/** A from→to mapping used to restore earlier operations. */
export interface FileOpPair {
  from: string;
  to: string;
}

/** Batch result: completed pairs plus failure messages (one failure does not stop the rest). */
export interface FileOpOutcome {
  completed: FileOpPair[];
  errors: string[];
}

/** Directory listing result; base is the start directory the target resolved itself (remote home). */
export interface FileListResult {
  base: string | null;
  entries: FsEntry[];
}

/** Execution target for file operations: the panel state selects the implementation. */
export type FileOpsTarget = { kind: 'local' } | { kind: 'ssh'; connectionId: string };

/** File operation interface: collision avoidance and undoable deletion are guaranteed by the implementations and backend. */
export interface FileOps {
  /** Delay between visible-tree checks; targets can account for channel latency. */
  refreshIntervalMs?: number;
  /** Slow channels check one visible directory per idle pass. */
  backgroundRefresh?: 'one-directory';
  /** Optional optimized traversal on the target's file channel. */
  search?(root: string, query: string, signal: AbortSignal,
    onProgress?: (result: { entries: FsEntry[]; truncated: boolean; skipped: number }) => void): Promise<{ entries: FsEntry[]; truncated: boolean; skipped: number }>;
  /** Single-path metadata: the path bar detects files with it and the properties dialog reads it. */
  stat(path: string): Promise<FileStat>;
  /** Lists a directory; dir null means the target's default start directory (remote returns the resolved base). */
  list(dir: string | null): Promise<FileListResult>;
  /** Path semantics (local and remote separator rules differ; each implementation supplies them). */
  parentOf(path: string): string | null;
  /** Splits into path segments for the breadcrumb. */
  segments(path: string): string[];
  /** Joins path segments back into a full path. */
  joinSegments(segments: string[]): string;
  join(dir: string, name: string): string;
  /** Creates an empty file or folder and returns the final path (a numeric suffix is added on collision). */
  createFile(dir: string, name: string): Promise<string>;
  createDir(dir: string, name: string): Promise<string>;
  /** Renames and returns the final path (a numeric suffix is added on collision). */
  rename(path: string, newName: string): Promise<string>;
  move(paths: string[], destDir: string): Promise<FileOpOutcome>;
  copy(paths: string[], destDir: string): Promise<FileOpOutcome>;
  /** Delete according to the target's undo preference; disabled undo returns empty staging paths. */
  stageDelete(paths: string[]): Promise<FileOpOutcome>;
  restoreStaged(pairs: FileOpPair[]): Promise<FileOpOutcome>;
  purgeStaged(paths: string[]): Promise<void>;
  /** Local panel's start directory (remote resolves it through list). */
  home?(): Promise<string>;
  /** Local only: disk view (shown when path is null). */
  disks?(): Promise<DiskEntry[]>;
  /** Remote only: upload a local path into a directory (returns the final remote path; no undo record when nothing is returned) / download to local and return the local path. */
  upload?(dir: string, localPath: string): Promise<string | void>;
  download?(path: string): Promise<string>;
}

/** Target → implementation: the view layer's only implementation choice. */
export function fileOpsFor(target: FileOpsTarget): FileOps {
  return target.kind === 'ssh' ? createSshFileOps(target.connectionId) : createLocalFileOps();
}

/**
 * Row hit by a context menu or drop → actual destination directory:
 * folder → itself; file → its parent directory; blank space → current directory.
 * Both panels share this rule instead of each keeping its own "menu position" logic.
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

/** Default names for new files and folders (the backend adds a numeric suffix on collision). */
export const DEFAULT_FILE_NAME = 'Untitled';
export const DEFAULT_DIR_NAME = 'NewFolder';
