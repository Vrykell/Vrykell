import { useFileUndoSettings } from '@config/fileUndo';
import {
  sshFsList, sshSearchFiles, sshRename, sshCreateFile, sshCreateDir, sshMove, sshCopy,
  sshStageDelete, sshRestoreStaged, sshPurgeStaged, sshUpload, sshDownload, sshStat,
} from '@features/ssh/services/api';
import { normalizeRemotePath, parentOfRemote, joinRemote } from '@features/ssh/utils/remotePath';
import type { FileOpOutcome, FileOps } from '@features/files/model/fileOps';

/** SSH 远程实现：路径语义为 POSIX，操作全部走后端 SFTP / 远端命令。 */
export function createSshFileOps(connectionId: string): FileOps {
  /** 逐条移动：后端会为重名自动加序号，逐条拿到真实目标路径（回退对依赖它）。 */
  const move = async (paths: string[], destDir: string): Promise<FileOpOutcome> => {
    const completed: FileOpOutcome['completed'] = [];
    const errors: string[] = [];
    for (const path of paths) {
      if (parentOfRemote(path) === destDir) continue;   // 同级：无操作
      try {
        completed.push({ from: path, to: await sshMove(connectionId, path, destDir) });
      } catch (error) {
        errors.push(String((error as Error)?.message ?? error));
      }
    }
    return { completed, errors };
  };

  return {
    search: (root, query, signal) => sshSearchFiles(connectionId, root, query, signal),
    stat: (path) => sshStat(connectionId, path),
    list: (dir) => sshFsList(connectionId, dir ?? undefined)
      .then((response) => ({
        base: response.base ? normalizeRemotePath(response.base) : null,
        entries: response.entries,
      })),
    parentOf: parentOfRemote,
    segments: (p) => normalizeRemotePath(p).split('/').filter(Boolean),
    joinSegments: (segs) => normalizeRemotePath(`/${segs.join('/')}`),
    join: joinRemote,
    createFile: (dir, name) => sshCreateFile(connectionId, dir, name),
    createDir: (dir, name) => sshCreateDir(connectionId, dir, name),
    rename: (path, newName) => sshRename(connectionId, path, newName),
    move,
    copy: (paths, destDir) => sshCopy(connectionId, paths, destDir),
    stageDelete: (paths) => useFileUndoSettings.getState().remote ? sshStageDelete(connectionId, paths) : sshStageDelete(connectionId, paths, false),
    restoreStaged: (pairs) => sshRestoreStaged(connectionId, pairs),
    purgeStaged: (paths) => sshPurgeStaged(connectionId, paths),
    upload: (dir, localPath) => sshUpload(connectionId, dir, localPath),
    download: (path) => sshDownload(connectionId, path),
  };
}
