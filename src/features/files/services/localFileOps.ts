import {
  fsList, fsDisks, fsHome, fsRename, fsCreateFile, fsCreateDir,
  fsCopy, fsMove, fsStageDelete, fsRestoreStaged, fsPurgeStaged,
} from '@platform/api/fs';
import { parentOf, pathSegments, segmentsToPath } from '@platform/path';
import type { FileOps } from '@features/files/model/fileOps';

/** 本地磁盘实现：路径语义来自 @platform/path，操作全部走后端文件命令。 */
export function createLocalFileOps(): FileOps {
  return {
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
    stageDelete: (paths) => fsStageDelete(paths).then((pairs) => ({ completed: pairs, errors: [] })),
    restoreStaged: (pairs) => fsRestoreStaged(pairs),
    purgeStaged: (paths) => fsPurgeStaged(paths),
    home: () => fsHome(),
    disks: () => fsDisks(),
  };
}
