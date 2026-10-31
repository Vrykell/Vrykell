import UploadManager from '@features/files/components/UploadManager';
import { preferredShell, useTerminalDefaults } from '@config/terminalDefaults';
import { useEffect, useState } from 'react';
import { openPath } from '@tauri-apps/plugin-opener';
import { Folder, HardDrive, StarFilled, iconSizes } from '@ui/icons';
import { fmtSize } from '@ui/actions/UiBtn';
import type { DiskEntry } from '@platform/api/types';
import { fileIcon } from '@features/files/utils/fileIcon';
import { fileOpenWith, fileRevealInDir, type FsEntry } from '@platform/api/fs';
import FilePanel from '@features/files/components/FilePanel';
import DownloadManager from '@features/files/components/DownloadManager';
import { openFile } from '@features/files/services/fileOpen';
import { openPreferredFile } from '../services/openPreferredFile';
import { useWorkspaceDirsStore } from '@features/files/services/workspaceDirs';
import { useLocalPathStore } from '@features/files/services/localPath';
import type { FileOpsTarget } from '@features/files/model/fileOps';
import { useActiveWorkspace } from '@features/workspace/hooks/useActiveWorkspace';
import { useDockStore, usePanelTerminal, useSessionStore, type PanelTerminalState } from '@features/workspace';
import type { TerminalBindingMenu } from '@ui/menus/terminalBindingMenu';
import { presentWorkspaceResource } from '@features/workspace/services/unifiedWorkspace';
import { ptyWrite } from '@platform/pty';
import { getAvailableShells } from '@platform/shells';
import { parentOf } from '@platform/path';
import { directoryCommand } from '@features/terminal/model/directoryCommand';
import { useTerminalStore } from '@features/terminal';
import { waitForTerminalStartup } from '@features/terminal/services/terminalStartup';
import { useToastStore } from '@ui/feedback/Toast';
import { t } from '@i18n';
import { ensureSshLoaded, useSshStore } from '@features/ssh';
import RemoteFiles from '@features/ssh/components/RemoteFiles';

/** The local panel's target is constant; the interface implementation is selected once. */
const LOCAL_TARGET: FileOpsTarget = { kind: 'local' };

/**
 * File panel entry point. An SSH connection uses remote browsing; otherwise the local disks are
 * shown. Both share FilePanel and useFileBrowser and differ only in their FileOps target.
 */
export default function PanelFiles() {
  const terminal = usePanelTerminal('files');
  const { focusedSpec, activeTab } = useActiveWorkspace();
  const connectionId = terminal.isBound
    ? terminal.connectionId
    : activeTab?.kind === 'editor' ? activeTab.selected.connectionId : focusedSpec?.ssh?.connectionId;
  const sshConnections = useSshStore((s) => s.connections);
  const sshLoaded = useSshStore((s) => s.loaded);
  const filesOpen = useDockStore(s => (s.leftPanels.includes('files') || s.rightPanels.includes('files')) && !s.collapsedPanels.includes('files'));
  useEffect(() => { ensureSshLoaded(); }, []);
  const terminalMenu: TerminalBindingMenu = {
    value: terminal.boundPaneId,
    options: terminal.options.map(option => ({ id: option.paneId, label: option.label, description: option.description, live: option.live })),
    onSelect: terminal.bind,
  };

  if (sshLoaded && connectionId) {
    const conn = sshConnections.find((c) => c.id === connectionId);
    if (conn) return <RemoteFiles key={conn.id} conn={conn} enabled={filesOpen} terminal={terminal} terminalMenu={terminalMenu} />;
  }
  return <LocalFiles enabled={filesOpen} terminal={terminal} terminalMenu={terminalMenu} />;
}

/** Local panel: provides the local-only menu entries, icons and disk view. */
function LocalFiles({ enabled, terminal, terminalMenu }: { enabled: boolean; terminal: PanelTerminalState; terminalMenu: TerminalBindingMenu }) {
  const [transferPage, setTransferPage] = useState<'upload' | 'download' | null>(null);
  const workspaceDirs = useWorkspaceDirsStore();
  const rememberedPath = useLocalPathStore((state) => state.remembered);
  const sessions = useTerminalStore(state => state.sessions);
  const shellTypes = useTerminalStore(state => state.shellTypes);
  const paneId = terminal.paneId;
  const shellType = (paneId ? shellTypes?.[paneId] : undefined) ?? terminal.spec?.shellType;

  /** Open a local file with the system default application. */
  const openWithSystemApp = (path: string) => {
    void openPath(path).catch((error) =>
      useToastStore.getState().addToast(`${t('Could not open the file')}: ${String((error as Error)?.message ?? error)}`, 'error'));
  };

  /** Open a local file in the terminal editor. */
  const openFileInTerminal = async (entry: FsEntry) => {
    const addToast = useToastStore.getState().addToast;
    let command = '';
    const shells = await getAvailableShells();
    const shellType = preferredShell(useTerminalDefaults.getState().shell, shells);
    try {
      const result = await openFile(entry.path, (nextCommand) => { command = nextCommand; }, shellType);
      if (result.via === 'system') {
        if (result.degraded) addToast(t('No terminal editor is available; opened with the system default application.'), 'info');
        return;
      }
      if (result.fellBack) addToast(t('The configured editor was not found; fell back to {{editor}}.', { editor: result.editor }), 'info');
    } catch (error) {
      addToast(String((error as Error)?.message ?? error), 'error');
      return;
    }
    if (!command) return;

    const parentDir = parentOf(entry.path) ?? undefined;
    const tabId = useSessionStore.getState().addTab({ cwd: parentDir, title: entry.name, shellType });
    presentWorkspaceResource(`terminal:${tabId}#0`);
    try {
      const sid = await waitForTerminalStartup(`${tabId}#0`);
      await ptyWrite(sid, command.endsWith('\n') ? command : `${command}\n`);
    } catch (error) {
      addToast(t('Could not run the file open command: {{error}}', { error: String((error as Error)?.message ?? error) }), 'error');
    }
  };

  if (transferPage === 'upload') return <UploadManager onBack={() => setTransferPage(null)} />;
  if (transferPage === 'download') return <DownloadManager onBack={() => setTransferPage(null)} />;

  return (
    <FilePanel
      target={LOCAL_TARGET}
      enabled={enabled}
      initialPath={rememberedPath ? rememberedPath.path : terminal.cwd ?? null}
      initialResolved={rememberedPath !== null}
      onPathChange={(next) => useLocalPathStore.getState().remember(next)}
      terminalCwd={terminal.cwd ?? null}
      followCwd={terminal.isBound ? terminal.cwd ?? null : null}
      terminalMenu={terminalMenu}
      openEntry={(entry) => void openPreferredFile({ path: entry.path }, () => openFileInTerminal(entry))}
      onSyncToTerminal={(dir) => {
        const sid = paneId ? sessions[paneId] : undefined;
        if (!sid) {
          useToastStore.getState().addToast(t('The terminal session is not ready.'), 'info');
          return;
        }
        void Promise.resolve().then(() => ptyWrite(sid, `${directoryCommand(dir, shellType)}\r`)).catch((error) =>
          useToastStore.getState().addToast(String((error as Error)?.message ?? error), 'error'));
      }}
      renderIcon={(entry) => {
        if (entry.is_dir) {
          return workspaceDirs.contains(entry.path)
            ? <StarFilled size={iconSizes.row} color="var(--favorite-color)" />
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
              {t('No disks available')}
            </div>
          )
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 10px' }}>
            {disks.map((disk) => <DiskCard key={disk.path} disk={disk} onOpen={() => navigate(disk.path)} />)}
          </div>
        )
      )}
      handlers={{
        onOpenEditor: (entry) => void openPreferredFile({ path: entry.path }, () => openFileInTerminal(entry)),
        onOpenSystem: (entry) => openWithSystemApp(entry.path),
        onOpenWith: (entry) => void fileOpenWith(entry.path).catch((error) =>
          useToastStore.getState().addToast(String((error as Error)?.message ?? error), 'error')),
        onOpenTab: (entry) => { const id = useSessionStore.getState().addTab({ cwd: entry.path, title: entry.name }); presentWorkspaceResource(`terminal:${id}#0`); },
        onWorkspaceToggle: (entry, inWorkspace) => {
          if (inWorkspace) {
            const workspace = workspaceDirs.dirs.find((item) => item.path === entry.path);
            if (workspace) void workspaceDirs.remove(workspace.id);
          } else {
            void workspaceDirs.add(entry.path, entry.name);
          }
        },
        onNewTabHere: (dir) => { const id = useSessionStore.getState().addTab({ cwd: dir, title: dir.split(/[\\/]/).filter(Boolean).pop() ?? dir }); presentWorkspaceResource(`terminal:${id}#0`); },
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

/** Disk card: icon, name and free space; click to navigate. */
function DiskCard({ disk, onOpen }: { disk: DiskEntry; onOpen: () => void }) {
  const total = disk.total_bytes;
  const free = disk.free_bytes;
  const pct = total > 0 ? Math.min(100, Math.round(((total - Math.max(0, total - free)) / total) * 100)) : 0;
  return (
    <div
      onClick={onOpen}
      data-tip={t('{{path}} · {{total}} total · {{percent}}% used', { path: disk.path, total: fmtSize(total), percent: pct })}
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
        background: 'var(--hover)', color: 'var(--primary-action)',
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
          {total > 0 ? t('{{free}} free', { free: fmtSize(free) }) : '—'}
        </div>
      </div>
    </div>
  );
}
