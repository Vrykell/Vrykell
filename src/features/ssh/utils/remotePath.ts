/**
 * remotePath — SSH 文件面板路径 store 与工具。
 *
 * 面板路径按连接 id 持久（跨标签一致）；SSH 会话没有 cwd 自动上报，
 * 由「同步到终端目录」按钮主动注入 OSC 7 后读取解析结果（见 RemoteFiles）。
 */

import { create } from 'zustand';
import { useSessionStore, isSessionTab } from '@features/workspace';
import { useTerminalStore } from '@features/terminal';
import { leaves } from '@features/workspace/model/windowLayout';

interface RemotePathState {
  /** 连接 id → 面板路径；null = 连接 home */
  path: Record<string, string | null>;
  set: (connId: string, p: string | null) => void;
}

export const useRemotePathStore = create<RemotePathState>((set) => ({
  path: {},
  set: (connId, p) => set((s) => ({ path: { ...s.path, [connId]: p } })),
}));

/** 规范化远程绝对路径：合并 ./..，去尾部斜杠（根除外）。 */
export function normalizeRemotePath(p: string): string {
  const parts: string[] = [];
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      parts.pop();
      continue;
    }
    parts.push(seg);
  }
  return '/' + parts.join('/') || '/';
}

/** 上级目录；根再上返回 null（= home）。 */
export function parentOfRemote(p: string): string | null {
  if (!p || p === '/') return null;
  const parent = normalizeRemotePath(`${p}/..`);
  return parent === p ? null : parent;
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
