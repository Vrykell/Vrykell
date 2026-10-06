import { useMemo, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import type { FsEntry } from '@platform/api/types';
import type { SshConnection } from '@features/ssh/services/api';
import FilePanel from '@features/files/components/FilePanel';
import DownloadManager from '@features/files/components/DownloadManager';
import { fileOpsFor, type FileOpsTarget } from '@features/files/model/fileOps';
import { loadConfig, remoteOpenCommand } from '@features/files/services/fileOpen';
import { describeFileServiceFailure } from '@features/ssh/model/fileServiceState';
import { useRemotePathStore, sshPaneIdFor, shellQuote } from '@features/ssh/utils/remotePath';
import { useTerminalStore, termInstances } from '@features/terminal';
import { useDockStore, useSessionStore } from '@features/workspace';
import { ptyWrite } from '@platform/pty';
import { useToastStore } from '@ui/Toast';
import ErrorBox from '@ui/ErrorBox';

/**
 * RemoteFiles — SSH 文件面板。
 *
 * 与本地文件面板共用 FilePanel + useFileBrowser：「操作哪个主机」只由这里的 target
 * 决定，菜单与拖放语义由面板配置推导；远程专有部分只有上传 / 下载、远端编辑器打开
 * 与文件服务失败说明。
 */
export default function RemoteFiles({ conn, enabled = true }: { conn: SshConnection; enabled?: boolean }) {
  const target = useMemo<FileOpsTarget>(() => ({ kind: 'ssh', connectionId: conn.id }), [conn.id]);
  const ops = useMemo(() => fileOpsFor(target), [target]);
  const storedPath = useRemotePathStore((state) => state.path[conn.id] ?? null);
  const [showDownloads, setShowDownloads] = useState(false);
  const paneId = sshPaneIdFor(conn.id);

  const toast = (message: string, type: 'info' | 'success' | 'error' = 'info') => {
    useToastStore.getState().addToast(message, type);
  };

  /** 双击 / Enter：把远端编辑器命令写进对应 SSH 终端 */
  const remoteEdit = (entry: FsEntry) => {
    const activeId = useSessionStore.getState().activeId;
    const sid = useTerminalStore.getState().sessions[activeId];
    if (!sid) {
      toast('SSH 会话未就绪', 'info');
      return;
    }
    void ptyWrite(sid, remoteOpenCommand(loadConfig(), entry.path)).catch(() => {});
  };

  /** 上传（菜单与系统拖入共用）：逐个上传并汇总结果 */
  const uploadPaths = async (paths: string[], dir: string) => {
    if (!ops.upload) return;
    toast(paths.length > 1 ? `开始上传 ${paths.length} 项…` : '正在上传…', 'info');
    let succeeded = 0;
    for (const localPath of paths) {
      try {
        await ops.upload(dir, localPath);
        succeeded += 1;
      } catch (error) {
        toast(`${localPath}：${String((error as Error)?.message ?? error)}`, 'error');
      }
    }
    if (succeeded > 0) toast(succeeded > 1 ? `已上传 ${succeeded} 项` : '已上传', 'success');
  };

  if (showDownloads) return <DownloadManager onBack={() => setShowDownloads(false)} />;

  return (
    <FilePanel
      target={target}
      enabled={enabled}
      initialPath={storedPath}
      onPathChange={(next) => useRemotePathStore.getState().set(conn.id, next)}
      openEntry={remoteEdit}
      onSyncToTerminal={(dir) => {
        const sid = paneId ? useTerminalStore.getState().sessions[paneId] : null;
        if (!sid) {
          toast('SSH 会话未就绪', 'info');
          return;
        }
        void ptyWrite(sid, `cd ${shellQuote(dir)}\r`).catch((error) =>
          toast(String((error as Error)?.message ?? error), 'error'));
      }}
      pendingLabel={`远程文件 · ${conn.name}`}
      renderError={(error, retry) => {
        const failure = describeFileServiceFailure(error);
        return (
          <ErrorBox
            tone={failure.kind === 'error' ? 'error' : 'info'}
            title={failure.title}
            details={error}
            style={{ margin: 16, overflowWrap: 'anywhere' }}
            actions={<>
              <button style={{ minHeight: 36 }} onClick={() => {
                const dock = useDockStore.getState();
                const side = dock.leftPanels.includes('files') ? 'left' : 'right';
                dock.togglePanel(side, 'files');
                if (paneId) termInstances.get(paneId)?.focus();
              }}>继续使用终端</button>
              <button style={{ minHeight: 36 }} onClick={retry}>重试文件服务</button>
            </>}
          >
            {failure.message}
          </ErrorBox>
        );
      }}
      handlers={{
        onDownload: (targets) => {
          void (async () => {
            if (!ops.download) return;
            toast(targets.some((entry) => entry.is_dir) ? '正在下载文件夹…' : '正在下载…', 'info');
            for (const entry of targets) {
              try {
                toast(`已下载到 ${await ops.download(entry.path)}`, 'success');
              } catch (error) {
                toast(String((error as Error)?.message ?? error), 'error');
              }
            }
          })();
        },
        onUpload: (kind) => {
          void (async () => {
            const selected = kind === 'dir'
              ? await open({ directory: true })
              : await open({ multiple: true, directory: false });
            const picked = (Array.isArray(selected) ? selected : selected ? [selected] : []).filter(Boolean);
            if (picked.length === 0 || storedPath === null) return;
            await uploadPaths(picked, storedPath);
          })();
        },
        onOpenDownloads: () => setShowDownloads(true),
      }}
      onExternalDrop={(paths, dropTarget) => { void uploadPaths(paths, dropTarget.dir); }}
      prepareNativeDrag={async (items) => {
        if (!ops.download) return null;
        toast('正在下载…', 'info');
        const locals: string[] = [];
        for (const item of items) {
          try {
            locals.push(await ops.download(item.path));
          } catch (error) {
            toast(String((error as Error)?.message ?? error), 'error');
          }
        }
        if (locals.length === 0) return null;
        toast(locals.length > 1 ? `已下载 ${locals.length} 项` : '已下载', 'success');
        // 远端文件已下载到本地：交给系统拖拽时用复制语义，远端源文件保留
        return { paths: locals, mode: 'copy' as const };
      }}
    />
  );
}
