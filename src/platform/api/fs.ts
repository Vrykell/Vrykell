import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { invoke } from '@platform/diagnostics';
import { normPath } from '@platform/path';
import type { FsEntry, DiskEntry, FileStat } from '@platform/api/types';

export type { FsEntry, DiskEntry, FileStat };

/**
 * Opens the native picker (file / multiple files / directory / save) and **registers the
 * selected paths in the backend**.
 *
 * Why the web view does not call the dialog plugin itself: commands that read file
 * contents (attachment import and similar) accept only paths produced by a user action,
 * and only the backend opening the picker knows the choice really came from the user —
 * the page receives a path, not the power to name arbitrary paths. The return value is
 * the absolute path normalized by the backend.
 */
export function pickPath(
  mode: 'file' | 'files' | 'directory' | 'save' = 'file',
  options?: { extensions?: string[]; fileName?: string },
): Promise<string[]> {
  return invoke<string[]>('pick_path', {
    request: {
      mode,
      extensions: options?.extensions ?? null,
      fileName: options?.fileName ?? null,
    },
  }).then(paths => paths.map(normPath));
}

/**
 * Local filesystem API — every path crossing the IPC boundary is normalized here:
 * input paths are turned into the front end's unified `/` form before invoke, and paths
 * returned by the backend (entries, disks, home) are normalized before reaching feature
 * code. Feature code uses the normalized path and never handles separators or drive roots
 * itself.
 */

/** Lists directory entries (when path is empty the backend chooses the start directory). */
export function fsList(path?: string | null): Promise<FsEntry[]> {
  return invoke<FsEntry[]>('fs_list', { path: path == null ? null : normPath(path) })
    .then((entries) => entries.map((entry) => ({ ...entry, path: normPath(entry.path) })));
}

/** Lists disks (root plus mounted volumes on macOS / drive letters on Windows) with capacity information. */
export function fsDisks(): Promise<DiskEntry[]> {
  return invoke<DiskEntry[]>('fs_disks')
    .then((disks) => disks.map((disk) => ({ ...disk, path: normPath(disk.path) })));
}

/** User home directory path. */
export function fsHome(): Promise<string> {
  return invoke<string>('fs_home').then((home) => normPath(home));
}

/** Read metadata for one local path (path bar file detection and the properties dialog). */
export function fsStat(path: string): Promise<FileStat> {
  return invoke<FileStat>('fs_stat', { path: normPath(path) })
    .then((stat) => ({ ...stat, path: normPath(stat.path) }));
}

/** Renames; when the target name is taken the backend appends a sequence number and returns the final path. */
export function fsRename(oldPath: string, newName: string): Promise<string> {
  return invoke<string>('fs_rename', { oldPath: normPath(oldPath), newName }).then(normPath);
}

/** Creates an empty file (auto-numbered on name clash) and returns the final path. */
export function fsCreateFile(dir: string, name: string): Promise<string> {
  return invoke<string>('fs_create_file', { dir: normPath(dir), name }).then(normPath);
}

/** Creates a folder (auto-numbered on name clash) and returns the final path. */
export function fsCreateDir(dir: string, name: string): Promise<string> {
  return invoke<string>('fs_create_dir', { dir: normPath(dir), name }).then(normPath);
}

/** One completed from→to pair (recorded so a file operation can be undone). */
export interface FileOpPair {
  from: string;
  to: string;
}

/** Result of a batch file operation: completed pairs plus failure messages (a partial failure does not stop the rest). */
export interface FileOpOutcome {
  completed: FileOpPair[];
  errors: string[];
}

function normalizePair(pair: FileOpPair): FileOpPair {
  return { from: normPath(pair.from), to: pair.to ? normPath(pair.to) : '' };
}

function normalizeOutcome(outcome: FileOpOutcome): FileOpOutcome {
  return { completed: outcome.completed.map(normalizePair), errors: outcome.errors };
}

/** Copies into the target directory (recursive for directories, symlinks copied as links). */
export function fsCopy(paths: string[], destDir: string): Promise<FileOpOutcome> {
  return invoke<FileOpOutcome>('fs_copy', { paths: paths.map(normPath), destDir: normPath(destDir) })
    .then(normalizeOutcome);
}

/** Moves into the target directory (cross-device moves degrade to copy + delete source). */
export function fsMove(paths: string[], destDir: string): Promise<FileOpOutcome> {
  return invoke<FileOpOutcome>('fs_move', { paths: paths.map(normPath), destDir: normPath(destDir) })
    .then(normalizeOutcome);
}

/** Reversible delete: moves content to the app staging area first and returns the original→staged mapping. */
export function fsStageDelete(paths: string[], undoEnabled = true): Promise<FileOpOutcome> {
  return invoke<FileOpOutcome>('fs_stage_delete', { paths: paths.map(normPath), ...(undoEnabled ? {} : { undoEnabled: false }) })
    .then(normalizeOutcome);
}

/** Undoes a staged delete: moves staged items back (an item reports an error when its original location is occupied). */
export function fsRestoreStaged(items: FileOpPair[]): Promise<FileOpOutcome> {
  return invoke<FileOpOutcome>('fs_restore_staged', { items: items.map(normalizePair) })
    .then(normalizeOutcome);
}

/** Sends staged items to the system trash (completes the delete once the undo window ends). */
export function fsPurgeStaged(paths: string[]): Promise<void> {
  return invoke('fs_purge_staged', { paths: paths.map(normPath) });
}

/** Opens a file through the system "open with" dialog (native picker on Windows, reveal in the file manager on macOS). */
export function fileOpenWith(path: string): Promise<void> {
  return invoke('file_open_with', { path: normPath(path) });
}

/** Reveals and selects the path in the system file manager. */
export function fileRevealInDir(path: string): Promise<void> {
  return revealItemInDir(path);
}
