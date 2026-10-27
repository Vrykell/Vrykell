/**
 * remotePath — path store and helpers for the SSH file panel.
 *
 * The panel path persists per connection id (consistent across tabs); SSH sessions do not report cwd automatically,
 * so the "sync to terminal directory" button injects OSC 7 and then reads the parsed result (see RemoteFiles).
 *
 * Path semantics (normalization / joining / parent) come from the platform layer `@platform/posixPath`;
 * this module only forwards them and owns the SSH-specific store/pane helpers.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useSessionStore, isSessionTab } from '@features/workspace';
import { useTerminalStore } from '@features/terminal';
import { leaves } from '@features/workspace/model/windowLayout';
import { normalizePosix, parentPosix, joinPosix } from '@platform/posixPath';
import { t } from '@i18n';

interface RemotePathState {
  /** Connection id → panel path; null = connection home */
  path: Record<string, string | null>;
  set: (connId: string, p: string | null) => void;
}

export const useRemotePathStore = create<RemotePathState>()(persist((set) => ({
  path: {},
  set: (connId, p) => set((s) => ({ path: { ...s.path, [connId]: p } })),
}), {
  name: 'vrykell-remote-files-locations',
  partialize: state => ({ path: state.path }),
  merge: (saved, current) => {
    const path = (saved as Partial<RemotePathState> | null)?.path;
    return { ...current, path: path && typeof path === 'object' && !Array.isArray(path)
      ? Object.fromEntries(Object.entries(path).filter(([connectionId, value]) => connectionId && (value === null || typeof value === 'string' && value.startsWith('/')))) : {} };
  },
}));

/** Normalizes a remote absolute path (POSIX semantics; implementation in the platform layer). */
export function normalizeRemotePath(p: string): string {
  return normalizePosix(p);
}

/** Parent directory; the parent of the root returns null (= home). */
export function parentOfRemote(p: string): string | null {
  if (!p || p === '/') return null;
  const parent = parentPosix(p);
  return parent === normalizePosix(p) ? null : parent;
}

/** POSIX path joining (directory + name). */
export function joinRemote(dir: string, name: string): string {
  return joinPosix(dir, name);
}

/** SSH pane id matching the connection in the active tab (focused pane preferred). */
export function sshPaneIdFor(connId: string): string | null {
  const ws = useSessionStore.getState();
  const at = ws.tabs.find((x) => x.id === ws.activeId);
  if (!at || !isSessionTab(at)) return null;
  const focused = useTerminalStore.getState().focusedPaneId;
  const matched = leaves(at.layout).filter(
    (t) => t.kind === 'ssh' && t.ssh?.connectionId === connId,
  );
  if (matched.length === 0) return null;
  return matched.some((t) => t.id === focused) ? focused : matched[0].id;
}

/** Wraps and escapes a shell single-quoted string (safe when the path contains spaces, single quotes or special characters). */
export function shellQuote(p: string): string {
  if (/[\x00-\x1f\x7f-\x9f]/.test(p)) throw new Error(t('Files with control characters cannot be opened in a terminal.'));
  return `'${p.replace(/'/g, "'\\''")}'`;
}
