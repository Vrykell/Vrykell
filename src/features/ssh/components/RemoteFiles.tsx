import UploadManager from '@features/files/components/UploadManager';
import { useMemo, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import type { FsEntry } from '@platform/api/types';
import type { SshConnection } from '@features/ssh/services/api';
import FilePanel from '@features/files/components/FilePanel';
import DownloadManager from '@features/files/components/DownloadManager';
import { fileOpsFor, type FileOpsTarget } from '@features/files/model/fileOps';
import { loadConfig, remoteOpenCommand } from '@features/files/services/fileOpen';
import { openPreferredFile } from '@features/files';
import { describeFileServiceFailure } from '@features/ssh/model/fileServiceState';
import { useRemotePathStore, sshPaneIdFor, shellQuote } from '@features/ssh/utils/remotePath';
import { useTerminalStore, termInstances } from '@features/terminal';
import { useDockStore, useSessionStore } from '@features/workspace';
import { presentWorkspaceResource } from '@features/workspace/services/unifiedWorkspace';
import { ptyWrite } from '@platform/pty';
import { terminalDebug } from '@features/terminal/services/terminalDebug';
import { getPaneTerminal } from '@features/terminal/services/terminalClipboard';
import { useToastStore } from '@ui/feedback/Toast';
import { t } from '@i18n';
import ErrorBox from '@ui/feedback/ErrorBox';
import { requestSshAuthentication, useSshAuthenticationRevision } from '../hooks/useSessionAuthentication';

/**
 * SSH file panel.
 *
 * Shares FilePanel and useFileBrowser with the local panel: this target alone decides which host
 * is operated on, and the panel configuration derives menu and drag semantics. The remote-only
 * parts are upload/download, opening in a remote editor and file-service failure messages.
 */
export default function RemoteFiles({ conn, enabled = true }: { conn: SshConnection; enabled?: boolean }) {
  const authenticationRevision = useSshAuthenticationRevision(conn.id);
  const target = useMemo<FileOpsTarget>(() => ({ kind: 'ssh', connectionId: conn.id }), [conn.id]);
  const ops = useMemo(() => fileOpsFor(target), [target]);
  const storedPath = useRemotePathStore((state) => state.path[conn.id] ?? null);
  const [transferPage, setTransferPage] = useState<'upload' | 'download' | null>(null);
  const paneId = sshPaneIdFor(conn.id);
  const terminalCwd = useSessionStore((state) => paneId ? state.terminalCwds[paneId] : undefined);

  const toast = (message: string, type: 'info' | 'success' | 'error' = 'info') => {
    useToastStore.getState().addToast(message, type);
  };

  /** Resolve the matching pane at action time, including split panes and tab changes. */
  const writeTerminalCommand = (command: string, action: 'edit' | 'sync-directory') => {
    const currentPaneId = sshPaneIdFor(conn.id);
    const terminal = useTerminalStore.getState();
    const sid = currentPaneId ? terminal.sessions[currentPaneId] : undefined;
    terminalDebug('remote-file-terminal-action', {
      action, paneId: currentPaneId, tabId: useSessionStore.getState().activeId, hasSession: Boolean(sid),
    });
    if (!sid || !currentPaneId) {
      toast(t('SSH session is not ready'), 'info');
      return;
    }
    void ptyWrite(sid, command).then(() => {
      if (sshPaneIdFor(conn.id) !== currentPaneId) return;
      useTerminalStore.getState().setFocusedPane(currentPaneId);
      getPaneTerminal(currentPaneId)?.focus();
      if (action === 'edit') presentWorkspaceResource(`terminal:${currentPaneId}`);
    }).catch((error) => toast(String((error as Error)?.message ?? error), 'error'));
  };

  /** Open a remote file in the terminal associated with this file panel. */
  const remoteEdit = (entry: FsEntry) => {
    try {
      void Promise.resolve(openPreferredFile({ path: entry.path, connectionId: conn.id }, () => writeTerminalCommand(remoteOpenCommand(loadConfig(), entry.path), 'edit')))
        .catch(error => toast(String(error), 'error'));
    } catch (error) { toast(String(error), 'error'); }
  };

  /** Upload paths one by one and aggregate the result (shared by the menu and system drops). */
  const uploadPaths = async (paths: string[], dir: string) => {
    if (!ops.upload || paths.length === 0) return;
    setTransferPage('upload');
    toast(paths.length > 1 ? t('files.upload.startCount', { n: paths.length }) : t('files.upload.start'), 'info');
    let succeeded = 0;
    for (const localPath of paths) {
      try {
        await ops.upload(dir, localPath);
        succeeded += 1;
      } catch (error) {
        toast(`${localPath}：${String((error as Error)?.message ?? error)}`, 'error');
      }
    }
    if (succeeded > 0) toast(succeeded > 1 ? t('files.upload.plainDoneCount', { n: succeeded }) : t('files.upload.plainDone'), 'success');
  };

  if (transferPage === 'upload') return <UploadManager onBack={() => setTransferPage(null)} />;
  if (transferPage === 'download') return <DownloadManager onBack={() => setTransferPage(null)} />;

  return (
    <FilePanel
      target={target}
      enabled={enabled}
      reloadRevision={authenticationRevision}
      initialPath={storedPath}
      terminalCwd={terminalCwd}
      onPathChange={(next) => useRemotePathStore.getState().set(conn.id, next)}
      openEntry={remoteEdit}
      onSyncToTerminal={(dir) => {
        try { writeTerminalCommand(`cd -- ${shellQuote(dir)}\r`, 'sync-directory'); }
        catch (error) { toast(String(error), 'error'); }
      }}
      pendingLabel={t('Remote files · {{name}}', { name: conn.name })}
      renderError={(error, retry) => {
        const failure = describeFileServiceFailure(error);
        return (
          <ErrorBox
            tone={failure.kind === 'error' ? 'error' : 'info'}
            title={failure.title}
            details={error}
            style={{ margin: 16, overflowWrap: 'anywhere' }}
            actions={<>
              {failure.kind === 'authentication' && <button style={{ minHeight: 36 }} onClick={() => requestSshAuthentication({ connectionId: conn.id, host: conn.host, port: conn.port, user: conn.user, identityFile: conn.identityFile })}>{t('Authenticate services')}</button>}
              <button style={{ minHeight: 36 }} onClick={() => {
                const dock = useDockStore.getState();
                const side = dock.leftPanels.includes('files') ? 'left' : 'right';
                dock.togglePanel(side, 'files');
                if (paneId) termInstances.get(paneId)?.focus();
              }}>{t('Continue using terminal')}</button>
              <button style={{ minHeight: 36 }} onClick={retry}>{t('Retry file service')}</button>
            </>}
          >
            {failure.message}
          </ErrorBox>
        );
      }}
      handlers={{
        onDownload: (targets) => {
          void (async () => {
            if (!ops.download || targets.length === 0) return;
            setTransferPage('download');
            toast(targets.some((entry) => entry.is_dir) ? t('files.download.startFolder') : t('files.download.start'), 'info');
            for (const entry of targets) {
              try {
                const localPath = await ops.download(entry.path);
                toast(t('files.download.doneTo', { path: localPath }), 'success');
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
        onOpenDownloads: () => setTransferPage('download'),
        onOpenUploads: () => setTransferPage('upload'),
      }}
      onExternalDrop={(paths, dropTarget) => { void uploadPaths(paths, dropTarget.dir); }}
      prepareNativeDrag={async (items) => {
        if (!ops.download || items.length === 0) return null;
        setTransferPage('download');
        toast(t('files.download.start'), 'info');
        const locals: string[] = [];
        for (const item of items) {
          try {
            locals.push(await ops.download(item.path));
          } catch (error) {
            toast(String((error as Error)?.message ?? error), 'error');
          }
        }
        if (locals.length === 0) return null;
        toast(locals.length > 1 ? t('files.download.plainDoneCount', { n: locals.length }) : t('files.download.plainDone'), 'success');
        // Dragging out downloads a copy for the system drag (accepted as a move); the remote
        // source stays, and the move cleanup applies only to the local panel.
        return { paths: locals, mode: 'move' as const };
      }}
    />
  );
}
