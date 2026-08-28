import { create } from 'zustand';
import { SquareStack, Folder, Server, Sparkles, type LucideIcon } from 'lucide-react';
import { safeJsonParse, safeLocalStorageGet, safeLocalStorageSet } from '../lib/errorHandler';
import { useWorkspaceStore, isSessionTab } from './workspace';
import { minTerminalWidth, MIN_PANE_SIZE } from '../lib/windowLayout';

// ── 面板定义（可扩展）──

export interface PanelDef {
  id: string;
  icon: LucideIcon;
  label: string;
  width: number;
}

export const PANEL_DEFS: Record<string, PanelDef> = {
  tabs:  { id: 'tabs',  icon: SquareStack, label: '标签', width: 200 },
  files: { id: 'files', icon: Folder, label: '资源', width: 240 },
  ssh:   { id: 'ssh',   icon: Server, label: 'SSH', width: 260 },
  chat:  { id: 'chat',  icon: Sparkles, label: 'AI', width: 320 },
};

export type DockSide = 'left' | 'right';

const STORAGE_KEY = 'dock-layout-v3';
const VALID_IDS = Object.keys(PANEL_DEFS);

interface PersistedLayout {
  leftZone: string[];
  rightZone: string[];
  leftPanels: string[];
  rightPanels: string[];
  panelWidths: Record<string, number>;
}

function isValidLayout(data: unknown): data is PersistedLayout {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  return (
    Array.isArray(d.leftZone) && d.leftZone.every((v: unknown) => typeof v === 'string' && VALID_IDS.includes(v)) &&
    Array.isArray(d.rightZone) && d.rightZone.every((v: unknown) => typeof v === 'string' && VALID_IDS.includes(v)) &&
    Array.isArray(d.leftPanels) && d.leftPanels.every((v: unknown) => typeof v === 'string' && VALID_IDS.includes(v)) &&
    Array.isArray(d.rightPanels) && d.rightPanels.every((v: unknown) => typeof v === 'string' && VALID_IDS.includes(v)) &&
    typeof d.panelWidths === 'object' && d.panelWidths !== null
  );
}

const DEFAULTS: PersistedLayout = {
  leftZone: ['tabs', 'ssh'], rightZone: ['files'],
  leftPanels: [], rightPanels: [],
  panelWidths: {},
};

function loadLayout(): PersistedLayout {
  const raw = safeLocalStorageGet(STORAGE_KEY);
  if (!raw) return DEFAULTS;
  const parsed = safeJsonParse<unknown>(raw);
  if (!isValidLayout(parsed)) {
    console.warn('[dock] layout data corrupted, resetting to defaults');
    return DEFAULTS;
  }
  // 迁移：新面板 id 未出现在任何 zone 时，追加到右侧，保证新增面板按钮可见
  const layout = parsed as PersistedLayout;
  const known = new Set([...layout.leftZone, ...layout.rightZone]);
  const missing = VALID_IDS.filter((id) => !known.has(id));
  if (missing.length > 0) {
    layout.rightZone = [...layout.rightZone, ...missing];
    saveLayout(layout);
  }
  // 面板顺序对齐按钮顺序（而非打开先后）
  layout.leftPanels = sortByZone(layout.leftPanels, layout.leftZone);
  layout.rightPanels = sortByZone(layout.rightPanels, layout.rightZone);
  return layout;
}

function saveLayout(layout: PersistedLayout) {
  safeLocalStorageSet(STORAGE_KEY, JSON.stringify(layout));
}

/** 按 zone（按钮顺序）排面板：不在 zone 内的排到末尾（防御）。 */
function sortByZone(panels: string[], zone: string[]): string[] {
  const rank = (id: string) => {
    const i = zone.indexOf(id);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...panels].sort((a, b) => rank(a) - rank(b));
}

interface DockState {
  leftZone: string[];
  rightZone: string[];
  /** 同侧可同时打开多个面板 */
  leftPanels: string[];
  rightPanels: string[];
  /** 每个面板的用户自定义宽度（px），未设置则用 PANEL_DEFS 默认值 */
  panelWidths: Record<string, number>;

  moveButton: (id: string, to: DockSide, atIndex?: number) => void;
  togglePanel: (side: DockSide, id: string) => void;
  /** 确保面板打开（已打开则无操作），自动判定所在侧 */
  openPanel: (id: string) => void;
  /** 拖动中调宽：拖到最小宽度下限 → 立即折叠（面板收起，可反向拖回恢复） */
  setPanelWidth: (id: string, delta: number) => void;
  /** 松手兜底：若仍处于折叠宽度则确认折叠（拖动中已折叠时幂等） */
  commitPanelWidth: (id: string) => void;
}

/** 每个侧栏面板自身的最小宽度（px）。 */
export const MIN_PANEL_WIDTH = 160;

/** 终端区域当前需要保留的最小宽度（按活跃窗口布局动态计算：单终端窄、多终端并排宽）。 */
function currentTerminalMinWidth(): number {
  const ws = useWorkspaceStore.getState();
  const tab = ws.tabs.find((t) => t.id === ws.activeId);
  return tab && isSessionTab(tab) ? minTerminalWidth(tab.layout) : MIN_PANE_SIZE;
}

const saved = loadLayout();

/** AI 面板是否已打开（打开时终端块流不再内联 AI 回答，避免两处重复）。
 *  AI 面板与终端强相关：无终端会话（设置/历史页）时视为未打开。 */
export function useChatPanelOpen(): boolean {
  const isSessionActive = useWorkspaceStore((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeId);
    return !!tab && isSessionTab(tab);
  });
  const chatInPanels = useDockStore((s) => s.leftPanels.includes('chat') || s.rightPanels.includes('chat'));
  return isSessionActive && chatInPanels;
}

export const useDockStore = create<DockState>((set) => ({
  leftZone: saved.leftZone,
  rightZone: saved.rightZone,
  leftPanels: saved.leftPanels,
  rightPanels: saved.rightPanels,
  panelWidths: saved.panelWidths,

  moveButton: (id, to, atIndex) => {
    set((s) => {
      const from: DockSide = s.leftZone.includes(id) ? 'left' : 'right';
      const fromList = from === 'left' ? [...s.leftZone] : [...s.rightZone];
      const srcIdx = fromList.indexOf(id);
      if (srcIdx === -1) return {};
      fromList.splice(srcIdx, 1);

      let leftZone = s.leftZone;
      let rightZone = s.rightZone;
      const targetList = from === to ? fromList : (to === 'left' ? [...leftZone] : [...rightZone]);
      let idx = atIndex ?? targetList.length;
      if (from === to && srcIdx < idx) idx = Math.max(0, idx - 1);
      idx = Math.max(0, Math.min(idx, targetList.length));
      targetList.splice(idx, 0, id);

      if (from === to) {
        if (from === 'left') leftZone = targetList;
        else rightZone = targetList;
      } else {
        if (to === 'left') { leftZone = targetList; rightZone = fromList; }
        else { leftZone = fromList; rightZone = targetList; }
      }

      // 面板在 from 侧打开 → 关掉；其余按新按钮顺序重排
      const leftPanels = sortByZone(from === 'left' ? s.leftPanels.filter((p) => p !== id) : s.leftPanels, leftZone);
      const rightPanels = sortByZone(from === 'right' ? s.rightPanels.filter((p) => p !== id) : s.rightPanels, rightZone);

      const next = { ...s, leftZone, rightZone, leftPanels, rightPanels };
      saveLayout(next);
      return next;
    });
  },

  togglePanel: (side, id) => {
    set((s) => {
      const zone = side === 'left' ? s.leftZone : s.rightZone;
      const panels = side === 'left' ? [...s.leftPanels] : [...s.rightPanels];
      const idx = panels.indexOf(id);
      if (idx >= 0) {
        panels.splice(idx, 1); // 已打开 → 关闭
      } else {
        // 未打开 → 打开，并按按钮顺序插入（而非打开先后）
        panels.push(id);
        const sorted = sortByZone(panels, zone);
        panels.splice(0, panels.length, ...sorted);
      }
      const patch: Partial<DockState> = side === 'left'
        ? { leftPanels: panels }
        : { rightPanels: panels };
      const full: PersistedLayout = { ...s, ...patch };
      saveLayout(full);
      return patch as DockState;
    });
  },

  openPanel: (id) => {
    set((s) => {
      const side: DockSide = s.leftZone.includes(id) ? 'left' : 'right';
      const zone = side === 'left' ? s.leftZone : s.rightZone;
      const panels = side === 'left' ? [...s.leftPanels] : [...s.rightPanels];
      if (panels.includes(id)) return {};
      panels.push(id);
      const sorted = sortByZone(panels, zone);
      panels.splice(0, panels.length, ...sorted);
      const patch: Partial<DockState> = side === 'left'
        ? { leftPanels: panels }
        : { rightPanels: panels };
      const full: PersistedLayout = { ...s, ...patch };
      saveLayout(full);
      return patch as DockState;
    });
  },

  setPanelWidth: (id, delta) => {
    set((s) => {
      // 用「当前 store 值 + 增量」累加（而非外部传入绝对宽度），消除快速拖动时
      // 渲染闭包陈旧导致的增量丢失（面板不跟手、终端 flex 反而在变）。
      const cur = s.panelWidths[id] ?? PANEL_DEFS[id]?.width ?? 200;
      const next = Math.round(cur + delta);
      // 拖到最小宽度下限 → 立即折叠（面板从所在侧移除、收起）；
      // 松手前反向拖回由 SidePanel 恢复（openPanel + 继续调宽）。
      if (next <= MIN_PANEL_WIDTH) {
        const leftPanels = s.leftPanels.includes(id) ? s.leftPanels.filter((p) => p !== id) : s.leftPanels;
        const rightPanels = s.rightPanels.includes(id) ? s.rightPanels.filter((p) => p !== id) : s.rightPanels;
        if (leftPanels === s.leftPanels && rightPanels === s.rightPanels) return {};
        const panelWidths = { ...s.panelWidths, [id]: MIN_PANEL_WIDTH };
        const patch = { leftPanels, rightPanels, panelWidths };
        const full: PersistedLayout = { ...s, ...patch };
        saveLayout(full);
        return patch as DockState;
      }
      // 未到下限：正常调宽（上限受窗口与终端最小宽约束）
      const allPanels = [...s.leftPanels, ...s.rightPanels];
      let otherWidth = 0;
      for (const pid of allPanels) {
        if (pid === id) continue;
        otherWidth += s.panelWidths[pid] ?? PANEL_DEFS[pid]?.width ?? 200;
      }
      const available = window.innerWidth - otherWidth;
      const maxW = Math.max(MIN_PANEL_WIDTH, Math.round(available - currentTerminalMinWidth()));
      const clamped = Math.max(MIN_PANEL_WIDTH, Math.min(maxW, next));
      if (clamped === cur) return {};
      const panelWidths = { ...s.panelWidths, [id]: clamped };
      const full = { ...s, panelWidths };
      saveLayout(full);
      return { panelWidths };
    });
  },

  commitPanelWidth: (id) => {
    set((s) => {
      const cur = s.panelWidths[id] ?? PANEL_DEFS[id]?.width ?? 200;
      // 松手兜底：宽度 ≤ 最小宽度 → 折叠（拖动中已折叠时幂等）
      if (cur > MIN_PANEL_WIDTH) return {};
      const leftPanels = s.leftPanels.includes(id) ? s.leftPanels.filter((p) => p !== id) : s.leftPanels;
      const rightPanels = s.rightPanels.includes(id) ? s.rightPanels.filter((p) => p !== id) : s.rightPanels;
      if (leftPanels === s.leftPanels && rightPanels === s.rightPanels) return {};
      const patch = { leftPanels, rightPanels };
      const full: PersistedLayout = { ...s, ...patch };
      saveLayout(full);
      return patch as DockState;
    });
  },
}));
