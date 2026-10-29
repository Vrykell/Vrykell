import { useFileUndoSettings } from '@config/fileUndo';
import {
  fsList, fsDisks, fsHome, fsRename, fsCreateFile, fsCreateDir,
  fsCopy, fsMove, fsStageDelete, fsRestoreStaged, fsPurgeStaged, fsStat,
} from '@platform/api/fs';
import { parentOf, pathSegments, segmentsToPath } from '@platform/path';
import type { FileOps } from '@features/files/model/fileOps';

/** Local disk implementation: path semantics come from @platform/path; all operations go through backend file commands. */
export function createLocalFileOps(): FileOps {
  return {
    refreshIntervalMs: 2000,
    stat: (path) => fsStat(path),
    list: (dir) => fsList(dir).then((entries) => ({ base: null, entries })),
    parentOf,
    segments: pathSegments,
    joinSegments: segmentsToPath,
    join: (dir, name) => segmentsToPath([...pathSegments(dir), name]),
    createFile: (dir, name) => fsCreateFile(dir, name),
    createDir: (dir, name) => fsCreateDir(dir, name),
    rename: (path, newName) => fsRename(path, newName),
    move: (paths, destDir) => fsMove(paths, destDir),
    copy: (paths, destDir) => fsCopy(paths, destDir),
    stageDelete: (paths) => useFileUndoSettings.getState().local ? fsStageDelete(paths) : fsStageDelete(paths, false),
    restoreStaged: (pairs) => fsRestoreStaged(pairs),
    purgeStaged: (paths) => fsPurgeStaged(paths),
    home: () => fsHome(),
    disks: () => fsDisks(),
  };
}
