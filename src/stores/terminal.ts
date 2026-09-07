import type { Terminal } from '@xterm/xterm';
import { create } from 'zustand';
import { ptyWrite } from '@/lib/pty';
import { firstLeaf, leaves as layoutLeaves } from '@/lib/windowLayout';
import { isSessionTab, useWorkspaceStore } from '@/stores/workspace';
import type { Scene } from '@/terminal/pipeline/sessionController';

// 每个标签页一个 xterm 实例（模块级引用，不进 zustand state）
const termInstances = new Map<string, Terminal>();

export { termInstances };

// e2e 测试桥：暴露 term 注册表供断言读取 buffer（WebGL renderer 下文本不进 DOM，
// 测试无法用 getByText 读终端输出）。仅测试环境初始化，不影响正常运行。
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__vrykellTerms = termInstances;
}

export function registerTerminal(tabId: string, t: Terminal) {
  termInstances.set(tabId, t);
}
export function unregisterTerminal(tabId: string, t: Terminal) {
  if (termInstances.get(tabId) === t) termInstances.delete(tabId);
}

/** 当前聚焦的终端 id：优先 focusedPaneId（校验其属于活跃窗口），否则活跃窗口第一个终端。 */
export function getFocusedTerminalId(): string {
  const ts = useTerminalStore.getState();
  const ws = useWorkspaceStore.getState();
  const tab = ws.tabs.find((t) => t.id === ws.activeId);
  if (tab && isSessionTab(tab)) {
    const ids = layoutLeaves(tab.layout);
    if (
      ts.focusedPaneId &&
      ts.sessions[ts.focusedPaneId] &&
      ids.some((t) => t.id === ts.focusedPaneId)
    ) {
      return ts.focusedPaneId;
    }
    return firstLeaf(tab.layout).id;
  }
  return ws.activeId;
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

/** 读取聚焦终端缓冲末尾 maxLines 行（去尾部空行），用于「输出发给 AI」。 */
export function getRecentOutput(maxLines = 30): string {
  return getRecentOutputFor(getFocusedTerminalId(), maxLines);
}

/** 实时终端画面（read_terminal 工具用）。 */
export interface TerminalScreen {
  scene: Scene;
  cols: number;
  rows: number;
  /** 光标在可见画面内的位置（0-based 行、列）；块列表等无光标场景为 null */
  cursorY: number | null;
  cursorX: number | null;
  /** 可见画面文本（带行号，去尾部空行） */
  content: string;
}

/**
 * 读取指定 pane 主 xterm 当前可见画面（classic / altScreen 场景）。
 * 覆盖范围 = 当前 viewport（alt buffer 即整个屏幕；normal buffer 为可见视口）。
 * 无 xterm 实例（如 blockList 下主 xterm 闲置/已卸载）返回 null，调用方自行回退。
 */
export function getTerminalScreen(paneId: string): TerminalScreen | null {
  const ts = useTerminalStore.getState();
  const scene = ts.scenes[paneId] ?? 'classic';
  const dims = ts.dims[paneId] ?? { cols: 80, rows: 24 };
  const term = termInstances.get(paneId);
  if (!term) return null;
  const buf = term.buffer.active;
  const cols = term.cols || dims.cols;
  const rows = term.rows || dims.rows;
  // viewportY = 可见区域顶部在 buffer 内的绝对行号；alt buffer 无 scrollback，恒为 0
  const start = Math.max(0, buf.viewportY);
  const end = Math.min(buf.length - 1, start + rows - 1);
  const lines: string[] = [];
  for (let i = start; i <= end; i++) {
    const line = buf.getLine(i);
    lines.push(line ? line.translateToString(true) : '');
  }
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') lines.pop();
  const content = lines.map((l, i) => `${String(i + 1).padStart(2, ' ')}│${l}`).join('\n');
  return {
    scene,
    cols,
    rows,
    cursorY: buf.cursorY,
    cursorX: buf.cursorX,
    content,
  };
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
  setScene: (tabId, scene) => set((s) => ({ scenes: { ...s.scenes, [tabId]: scene } })),
  setSession: (tabId, sessionId) =>
    set((s) => ({ sessions: { ...s.sessions, [tabId]: sessionId } })),
  setDims: (tabId, cols, rows) => set((s) => ({ dims: { ...s.dims, [tabId]: { cols, rows } } })),
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
    // 写入聚焦终端的 PTY
    const target = getFocusedTerminalId();
    const sessionId = get().sessions[target];
    set({ visible: true });
    if (!sessionId) return;
    ptyWrite(sessionId, command.endsWith('\n') ? command : command + '\n').catch(() => {});
  },
  pendingInput: '',
  setPendingInput: (text) => set({ pendingInput: text }),
}));
