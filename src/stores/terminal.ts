import { create } from 'zustand';
import { ptyWrite } from '../lib/pty';
import { useWorkspaceStore } from './workspace';
import type { Terminal } from '@xterm/xterm';
import type { Scene } from '../terminal/pipeline/sessionController';

// 每个标签页一个 xterm 实例（模块级引用，不进 zustand state）
const termInstances = new Map<string, Terminal>();
export { termInstances };

export function registerTerminal(tabId: string, t: Terminal) {
  termInstances.set(tabId, t);
}
export function unregisterTerminal(tabId: string, t: Terminal) {
  if (termInstances.get(tabId) === t) termInstances.delete(tabId);
}

/** 获取终端的当前 viewportY（滚动位置，行号）。 */
export function getViewportY(tabId: string): number {
  const term = termInstances.get(tabId);
  if (!term) return 0;
  return term.buffer.active.viewportY;
}

/** 获取终端的行高（像素），用于 gutter 定位。 */
export function getLineHeight(tabId: string): number {
  const term = termInstances.get(tabId);
  if (!term) return 18;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dims = (term as any)._core?._renderService?.dimensions;
  if (dims?.css?.cell?.height) return dims.css.cell.height;
  try {
    return Math.round(((term as any).options?.fontSize ?? 13) * 1.3);
  } catch {
    return 18;
  }
}

/** 从 term buffer 读取指定行范围（绝对行号）的纯文本。 */
export function getTerminalOutput(tabId: string, startLine: number, endLine: number | null): string {
  const term = termInstances.get(tabId);
  if (!term) return '';
  const buf = term.buffer.active;
  const end = endLine ?? (buf.baseY + buf.cursorY);
  const lines: string[] = [];
  for (let i = startLine; i <= end; i++) {
    const line = buf.getLine(i);
    if (line) lines.push(line.translateToString(true));
  }
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') lines.pop();
  return lines.join('\n');
}

/** 纯函数：从 focusedPaneId 解析聚焦 pane（校验其属于活跃标签，切标签后不残留）。 */
export function resolveFocusedPaneId(
  activeId: string,
  focusedPaneId: string | null,
  sessions: Record<string, string>,
): string {
  const fp = focusedPaneId;
  if (fp && (fp === activeId || fp === `${activeId}#2`) && sessions[fp]) return fp;
  return activeId;
}

/** 当前聚焦的 paneId：分屏时用 focusedPaneId（校验其属于活跃标签），否则活跃标签 id。 */
export function getFocusedPaneId(): string {
  const ts = useTerminalStore.getState();
  return resolveFocusedPaneId(useWorkspaceStore.getState().activeId, ts.focusedPaneId, ts.sessions);
}

/** 读取指定 pane 终端缓冲末尾 maxLines 行（去尾部空行），用于「输出发给 AI」。 */
export function getRecentOutputFor(paneId: string, maxLines = 30): string {
  const term = termInstances.get(paneId);
  if (!term) return '';
  const buf = term.buffer.active;
  const end = buf.baseY + buf.cursorY;
  const start = Math.max(0, end - maxLines + 1);
  const lines: string[] = [];
  for (let i = start; i <= end; i++) {
    const line = buf.getLine(i);
    if (line) lines.push(line.translateToString(true));
  }
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') lines.pop();
  return lines.join('\n');
}

/** 读取活跃标签终端缓冲末尾 maxLines 行（去尾部空行），用于「输出发给 AI」。 */
export function getRecentOutput(maxLines = 30): string {
  return getRecentOutputFor(useWorkspaceStore.getState().activeId, maxLines);
}

interface TerminalState {
  /** tabId → PTY session id */
  sessions: Record<string, string>;
  /** tabId → 终端尺寸（状态栏展示用） */
  dims: Record<string, { cols: number; rows: number }>;
  visible: boolean;
  /** 手动全屏块终端（块卡片「进入全屏交互」）。
   *  仅为手动全屏置位；真实 alt buffer 应用（vim/htop，1049h）看 scenes[tabId] === 'altScreen' */
  altScreenActive: boolean;
  setAltScreenActive: (active: boolean) => void;
  /** 键盘路由目标：'input' → InputEditor, 'terminal' → xterm.js */
  keyboardTarget: 'input' | 'terminal';
  setKeyboardTarget: (t: 'input' | 'terminal') => void;
  /** 分屏时聚焦的 paneId（决定键盘输入/runInTerminal 写哪个 PTY） */
  focusedPaneId: string | null;
  setFocusedPane: (paneId: string | null) => void;
  /** tabId → 当前场景状态机（classic / blockList / altScreen） */
  scenes: Record<string, Scene>;
  setScene: (tabId: string, scene: Scene) => void;
  setSession: (tabId: string, sessionId: string) => void;
  setDims: (tabId: string, cols: number, rows: number) => void;
  /** 关 tab 时删除该 tab 的 session/dims/scene，避免 per-tab 残留 */
  dropTab: (tabId: string) => void;
  toggle: () => void;
  runInTerminal: (command: string) => void;
  /** 外部写入输入栏（搜索点击历史命令等），InputEditor 消费后自动清空 */
  pendingInput: string;
  setPendingInput: (text: string) => void;
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  sessions: {},
  dims: {},
  visible: true,
  altScreenActive: false,
  scenes: {} as Record<string, Scene>,
  setAltScreenActive: (active) => set({ altScreenActive: active }),
  keyboardTarget: 'input',
  setKeyboardTarget: (t) => set({ keyboardTarget: t }),
  focusedPaneId: null,
  setFocusedPane: (paneId) => set({ focusedPaneId: paneId }),
  setScene: (tabId, scene) =>
    set((s) => ({ scenes: { ...s.scenes, [tabId]: scene } })),
  setSession: (tabId, sessionId) =>
    set((s) => ({ sessions: { ...s.sessions, [tabId]: sessionId } })),
  setDims: (tabId, cols, rows) =>
    set((s) => ({ dims: { ...s.dims, [tabId]: { cols, rows } } })),
  dropTab: (tabId) =>
    set((s) => {
      if (!(tabId in s.sessions) && !(tabId in s.dims) && !(tabId in s.scenes)) return s;
      const sessions = { ...s.sessions };
      const dims = { ...s.dims };
      const scenes = { ...s.scenes };
      delete sessions[tabId];
      delete dims[tabId];
      delete scenes[tabId];
      return { sessions, dims, scenes };
    }),
  toggle: () => set((s) => ({ visible: !s.visible })),
  runInTerminal: (command) => {
    // 分屏时写聚焦 pane，否则写活跃标签
    const target = getFocusedPaneId();
    const sessionId = get().sessions[target];
    set({ visible: true });
    if (!sessionId) return;
    ptyWrite(sessionId, command.endsWith('\n') ? command : command + '\n').catch(() => {});
  },
  pendingInput: '',
  setPendingInput: (text) => set({ pendingInput: text }),
}));
