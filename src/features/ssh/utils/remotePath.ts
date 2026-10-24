/**
 * remotePath — SSH 文件面板路径 store 与工具。
 *
 * 面板路径按连接 id 持久（跨标签一致）；SSH 会话没有 cwd 自动上报，
 * 由「同步到终端目录」按钮主动注入 OSC 7 后读取解析结果（见 RemoteFiles）。
 *
 * 路径语义（规范化 / 拼接 / 上级目录）统一来自平台层 `@platform/posixPath`，
 * 这里只做转发与 store/pane 相关的 SSH 专属工具。
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useSessionStore, isSessionTab } from '@features/workspace';
import { useTerminalStore } from '@features/terminal';
import { leaves } from '@features/workspace/model/windowLayout';
import { normalizePosix, parentPosix, joinPosix } from '@platform/posixPath';

interface RemotePathState {
  /** 连接 id → 面板路径；null = 连接 home */
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

/** 规范化远程绝对路径（POSIX 语义，实现见平台层）。 */
export function normalizeRemotePath(p: string): string {
  return normalizePosix(p);
}

/** 上级目录；根再上返回 null（= home）。 */
export function parentOfRemote(p: string): string | null {
  if (!p || p === '/') return null;
  const parent = parentPosix(p);
  return parent === normalizePosix(p) ? null : parent;
}

/** POSIX 路径拼接（目录 + 名称）。 */
export function joinRemote(dir: string, name: string): string {
  return joinPosix(dir, name);
}

/** 当前活跃标签里与指定连接匹配的 SSH pane id（优先聚焦 pane）。 */
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

/** shell 单引号包裹并转义（路径含空格/单引号/特殊字符时安全）。 */
export function shellQuote(p: string): string {
  return `'${p.replace(/'/g, "'\\''")}'`;
}
