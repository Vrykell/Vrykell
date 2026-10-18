import UploadManager from '@features/files/components/UploadManager';
import { preferredShell, useTerminalDefaults } from '@config/terminalDefaults';
import { useEffect, useState } from 'react';
import { openPath } from '@tauri-apps/plugin-opener';
import { Folder, HardDrive, Star, iconSizes } from '@ui/icons';
import { fmtSize } from '@ui/UiBtn';
import type { DiskEntry } from '@platform/api/types';
import { fileIcon } from '@features/files/utils/fileIcon';
import { fileOpenWith, fileRevealInDir, type FsEntry } from '@platform/api/fs';
import FilePanel from '@features/files/components/FilePanel';
import DownloadManager from '@features/files/components/DownloadManager';
import { openFile } from '@features/files/services/fileOpen';
import { useWorkspaceDirsStore } from '@features/files/services/workspaceDirs';
import { useLocalPathStore } from '@features/files/services/localPath';
import type { FileOpsTarget } from '@features/files/model/fileOps';
import { useActiveWorkspace } from '@features/workspace/hooks/useActiveWorkspace';
import { useDockStore, useSessionStore } from '@features/workspace';
import { ptyWrite } from '@platform/pty';
import { getAvailableShells } from '@platform/shells';
import { parentOf } from '@platform/path';
import { shellQuote } from '@features/ssh/utils/remotePath';
import { waitForTerminalStartup } from '@features/terminal/services/terminalStartup';
import { useToastStore } from '@ui/Toast';
import { t } from '@i18n';
import { ensureSshLoaded, useSshStore } from '@features/ssh';
import RemoteFiles from '@features/ssh/components/RemoteFiles';

/** 本地面板的目标是常量：接口实现在这里只被选中一次。 */
const LOCAL_TARGET: FileOpsTarget = { kind: 'local' };

/**
 * PanelFiles — 文件面板入口。
 * 活跃标签页为 SSH 连接时切到远程浏览，否则浏览本地磁盘；
 * 两者共用同一套 FilePanel + useFileBrowser，只有执行目标（target）不同。
 */
export default function PanelFiles() {
  const { focusedSpec } = useActiveWorkspace();
  const sshConnections = useSshStore((s) => s.connections);
  const sshLoaded = useSshStore((s) => s.loaded);
  const filesOpen = useDockStore(s => (s.leftPanels.includes('files') || s.rightPanels.includes('files')) && !s.collapsedPanels.includes('files'));
  useEffect(() => { ensureSshLoaded(); }, []);

  if (sshLoaded && focusedSpec?.kind === 'ssh' && focusedSpec.ssh?.connectionId) {
    const conn = sshConnections.find((c) => c.id === focusedSpec.ssh!.connectionId);
    if (conn) return <RemoteFiles key={conn.id} conn={conn} enabled={filesOpen} />;
  }
  return <LocalFiles />;
}

/** 本地面板：只提供本地专有的菜单项、图标与磁盘视图。 */
function LocalFiles() {
  const [transferPage, setTransferPage] = useState<'upload' | 'download' | null>(null);
  const workspaceDirs = useWorkspaceDirsStore();
  const rememberedPath = useLocalPathStore((state) => state.remembered);
  // Start directory: the session's remembered location, otherwise the focused terminal cwd.
  // Navigation stays decoupled from the terminal afterwards.
  const { focusedPaneId: focused, activeCwd, sessions } = useActiveWorkspace();

  /** Open a local file with the system default application (menu item and path bar). */
  const openWithSystemApp = (path: string) => {
    void openPath(path).catch((error) =>
      useToastStore.getState().addToast(`${t('Could not open the file')}: ${String((error as Error)?.message ?? error)}`, 'error'));
  };

  /** 在终端编辑器中打开（本地专有语义） */
  const openFileInTerminal = async (entry: FsEntry) => {
    const addToast = useToastStore.getState().addToast;
    let command = '';
    try {
      const result = await openFile(entry.path, (nextCommand) => { command = nextCommand; });
      if (result.via === 'system') {
        if (result.degraded) addToast('未找到可用的终端编辑器，已用系统默认应用打开', 'info');
        return;
      }
      if (result.fellBack) addToast(`未找到配置的编辑器，已降级为 ${result.editor}`, 'info');
    } catch (error) {
      addToast(String((error as Error)?.message ?? error), 'error');
      return;
    }
    if (!command) return;

    const parentDir = parentOf(entry.path) ?? undefined;
    const shells = await getAvailableShells();
    const shellType = preferredShell(useTerminalDefaults.getState().shell, shells);
    const tabId = useSessionStore.getState().addTab({ cwd: parentDir, title: entry.name, shellType });
    try {
      const sid = await waitForTerminalStartup(`${tabId}#0`);
      await ptyWrite(sid, command.endsWith('\n') ? command : `${command}\n`);
    } catch (error) {
      addToast(`无法执行文件打开命令：${String((error as Error)?.message ?? error)}`, 'error');
    }
  };

  if (transferPage === 'upload') return <UploadManager onBack={() => setTransferPage(null)} />;
  if (transferPage === 'download') return <DownloadManager onBack={() => setTransferPage(null)} />;

  return (
    <FilePanel
      target={LOCAL_TARGET}
      initialPath={rememberedPath ? rememberedPath.path : activeCwd ?? null}
      initialResolved={rememberedPath !== null}
      onPathChange={(next) => useLocalPathStore.getState().remember(next)}
      terminalCwd={activeCwd ?? null}
      openEntry={(entry) => void openFileInTerminal(entry)}
      onSyncToTerminal={(dir) => {
        const sid = sessions[focused];
        if (!sid) {
          useToastStore.getState().addToast('终端会话未就绪', 'info');
          return;
        }
        void ptyWrite(sid, `cd ${shellQuote(dir)}\r`).catch((error) =>
          useToastStore.getState().addToast(String((error as Error)?.message ?? error), 'error'));
      }}
      renderIcon={(entry) => {
        if (entry.is_dir) {
          return workspaceDirs.contains(entry.path)
            ? <Star size={iconSizes.row} fill="currentColor" />
            : <Folder size={iconSizes.row} fill="none" />;
        }
        const Icon = fileIcon(entry.name);
        return <Icon size={iconSizes.row} fill="none" />;
      }}
      isHighlighted={(entryPath) => workspaceDirs.contains(entryPath)}
      renderNullPathView={({ disks, settled, navigate }) => (
        disks.length === 0 ? (
          settled && (
            <div style={{ padding: 16, fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--text-muted)', textAlign: 'center' }}>
              暂无可用磁盘
            </div>
          )
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 10px' }}>
            {disks.map((disk) => <DiskCard key={disk.path} disk={disk} onOpen={() => navigate(disk.path)} />)}
          </div>
        )
      )}
      handlers={{
        onOpenEditor: (entry) => void openFileInTerminal(entry),
        onOpenSystem: (entry) => openWithSystemApp(entry.path),
        onOpenWith: (entry) => void fileOpenWith(entry.path).catch((error) =>
          useToastStore.getState().addToast(String((error as Error)?.message ?? error), 'error')),
        onOpenTab: (entry) => useSessionStore.getState().addTab({ cwd: entry.path, title: entry.name }),
        onWorkspaceToggle: (entry, inWorkspace) => {
          if (inWorkspace) {
            const workspace = workspaceDirs.dirs.find((item) => item.path === entry.path);
            if (workspace) void workspaceDirs.remove(workspace.id);
          } else {
            void workspaceDirs.add(entry.path, entry.name);
          }
        },
        onNewTabHere: (dir) => useSessionStore.getState().addTab({ cwd: dir, title: dir.split(/[\\/]/).filter(Boolean).pop() ?? dir }),
        onOpenDownloads: () => setTransferPage('download'),
        onOpenUploads: () => setTransferPage('upload'),
        onReveal: (entry) => void fileRevealInDir(entry.path).catch((error) =>
          useToastStore.getState().addToast(String((error as Error)?.message ?? error), 'error')),
        onRevealDir: (dir) => void fileRevealInDir(dir).catch((error) =>
          useToastStore.getState().addToast(String((error as Error)?.message ?? error), 'error')),
      }}
    />
  );
}

/** 磁盘小卡片：图标 + 名称 + 可用容量；单击进入。 */
function DiskCard({ disk, onOpen }: { disk: DiskEntry; onOpen: () => void }) {
  const total = disk.total_bytes;
  const free = disk.free_bytes;
  const pct = total > 0 ? Math.min(100, Math.round(((total - Math.max(0, total - free)) / total) * 100)) : 0;
  return (
    <div
      onClick={onOpen}
      data-tip={`${disk.path} · 共 ${fmtSize(total)} · 已用 ${pct}%`}
      data-testid={`disk-card-${disk.name}`}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '6px 10px', borderRadius: 8,
        cursor: 'pointer', userSelect: 'none',
      }}
    >
      <span style={{
        width: 34, height: 34, borderRadius: 8, flexShrink: 0,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--hover)', color: 'var(--accent)',
      }}>
        <HardDrive size={iconSizes.row} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 'calc(12px * var(--ui-font-scale))', fontWeight: 'var(--fw-semibold)', color: 'var(--text-primary)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {disk.name}
        </div>
        <div style={{
          fontSize: 'calc(10.5px * var(--ui-font-scale))', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)',
          marginTop: 1,
        }}>
          {total > 0 ? `${fmtSize(free)} 可用` : '—'}
        </div>
      </div>
    </div>
  );
}
