import { create } from 'zustand';
import { SquareStack, Folder, Server, Sparkles, Settings, DataUsage, type AppIcon } from '@ui/icons';
import { t } from '@i18n';
import { safeJsonParse, safeLocalStorageGet, safeLocalStorageSet } from '@utils/errorHandler';
import { useWorkspaceStore, isSessionTab } from '@features/workspace/stores/workspace';
import { minTerminalWidth, MIN_PANE_SIZE } from '@features/workspace/model/windowLayout';

// ── 面板定义（可扩展）──

export interface PanelDef {
  id: string;
  icon: AppIcon;
  label: string;
  width: number;
  /** Panels opened from another surface keep their layout slot but render no navigation button. */
  hideButton?: boolean;
}

export const PANEL_DEFS: Record<string, PanelDef> = {
  tabs:  { id: 'tabs',  icon: SquareStack, label: '标签', width: 180 },
  files: { id: 'files', icon: Folder, label: '资源', width: 200 },
  ssh:   { id: 'ssh',   icon: Server, label: 'SSH', width: 208 },
  chat:  { id: 'chat',  icon: Sparkles, label: 'AI', width: 320 },
  usage: { id: 'usage', icon: DataUsage, label: t('Usage'), width: 240, hideButton: true },
};

export type DockSide = 'left' | 'right';

// Page actions participate in navigation placement without becoming sidebars.
export const NAVIGATION_DEFS: Record<string, Pick<PanelDef, 'id' | 'icon' | 'label'>> = {
  ...PANEL_DEFS,
  settings: { id: 'settings', icon: Settings, label: '设置' },
};

const STORAGE_KEY = 'dock-layout-v4';
const LEGACY_STORAGE_KEY = 'dock-layout-v3';
const VALID_IDS = Object.keys(NAVIGATION_DEFS);
const PANEL_IDS = Object.keys(PANEL_DEFS);

interface PersistedLayout {
  widthPreset?: 'compact';
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
    Array.isArray(d.leftPanels) && d.leftPanels.every((v: unknown) => typeof v === 'string' && PANEL_IDS.includes(v)) &&
    Array.isArray(d.rightPanels) && d.rightPanels.every((v: unknown) => typeof v === 'string' && PANEL_IDS.includes(v)) &&
    typeof d.panelWidths === 'object' && d.panelWidths !== null
  );
}

const DEFAULTS: PersistedLayout = {
  leftZone: ['tabs', 'ssh', 'files'], rightZone: ['chat', 'usage', 'settings'],
  // Start with the session list; auxiliary panels open on demand.
  leftPanels: ['tabs'], rightPanels: [],
  panelWidths: {},
};

function loadLayout(): PersistedLayout {
  let raw = safeLocalStorageGet(STORAGE_KEY);
  let migratingLegacy = false;
  if (!raw) {
    raw = safeLocalStorageGet(LEGACY_STORAGE_KEY);
    migratingLegacy = !!raw;
  }
  if (!raw) return DEFAULTS;
  const parsed = safeJsonParse<unknown>(raw);
  if (!isValidLayout(parsed)) {
    console.warn('[dock] layout data corrupted, resetting to defaults');
    return DEFAULTS;
  }
  // Preserve saved placement, repair duplicate entries, and add missing actions.
  const layout: PersistedLayout = {
    leftZone: [...new Set(parsed.leftZone)],
    rightZone: [...new Set(parsed.rightZone)].filter(id => !parsed.leftZone.includes(id)),
    leftPanels: [...parsed.leftPanels],
    rightPanels: [...parsed.rightPanels],
    panelWidths: { ...parsed.panelWidths },
  };
  // Apply compact defaults once to oversized legacy widths, then retain future resizing.
  if (parsed.widthPreset !== 'compact') {
    for (const [id, width] of Object.entries(layout.panelWidths)) {
      const defaultWidth = PANEL_DEFS[id]?.width;
      if (defaultWidth && width > defaultWidth) layout.panelWidths[id] = defaultWidth;
    }
  }
  const known = new Set([...layout.leftZone, ...layout.rightZone]);
  const missing = VALID_IDS.filter((id) => !known.has(id));
  if (missing.length > 0) {
    layout.leftZone.push(...missing.filter(id => DEFAULTS.leftZone.includes(id)));
    layout.rightZone.push(...missing.filter(id => !DEFAULTS.leftZone.includes(id)));
  }
  // v3 的默认布局会把多个侧栏同时打开。升级时保留按钮位置和宽度，
  // 只恢复会话列表，避免旧缓存继续占用终端空间。
  if (migratingLegacy) {
    const tabsOnLeft = layout.leftZone.includes('tabs');
    layout.leftPanels = tabsOnLeft ? ['tabs'] : [];
    layout.rightPanels = tabsOnLeft ? [] : (layout.rightZone.includes('tabs') ? ['tabs'] : []);
  }
  const openPanels = [...new Set([...layout.leftPanels, ...layout.rightPanels])];
  layout.leftPanels = sortByZone(openPanels.filter(id => layout.leftZone.includes(id)), layout.leftZone).slice(0, 1);
  layout.rightPanels = sortByZone(openPanels.filter(id => layout.rightZone.includes(id)), layout.rightZone).slice(0, 1);
  saveLayout(layout);
  return layout;
}

function saveLayout(layout: PersistedLayout) {
  safeLocalStorageSet(STORAGE_KEY, JSON.stringify({ ...layout, widthPreset: 'compact' }));
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
  /** Each side displays one panel at a time. */
  leftPanels: string[];
  rightPanels: string[];
  /** 每个面板的用户自定义宽度（px），未设置则用 PANEL_DEFS 默认值 */
  panelWidths: Record<string, number>;
  /**
   * 拖动中折叠、尚未松手定局的面板：仍留在 leftPanels/rightPanels 中保持挂载
   * （内容状态不丢），拖动中隐藏、松手后定局（commit 决定去留）。
   */
  collapsedPanels: string[];

  moveButton: (id: string, to: DockSide, atIndex?: number) => void;
  togglePanel: (side: DockSide, id: string) => void;
  /** 确保面板打开（已打开则无操作），自动判定所在侧 */
  openPanel: (id: string) => void;
  /** 拖动中调宽：拖到最小宽度下限 → 折叠（面板隐藏但保持挂载，可反向拖回恢复） */
  setPanelWidth: (id: string, delta: number) => void;
  /** 松手定局：宽度仍 ≤ 下限 → 正式折叠（下架）；否则恢复展开 */
  commitPanelWidth: (id: string) => void;
  reconcilePanelSpace: () => void;
}

/** 每个侧栏面板自身的最小宽度（px）。 */
export const MIN_PANEL_WIDTH = 160;

/** 终端区域当前需要保留的最小宽度（按活跃窗口布局动态计算：单终端窄、多终端并排宽）。 */
function currentTerminalMinWidth(): number {
  const ws = useWorkspaceStore.getState();
  const tab = ws.tabs.find((t) => t.id === ws.activeId);
  return tab && isSessionTab(tab) ? minTerminalWidth(tab.layout) : MIN_PANE_SIZE;
}

export const ACTIVITY_BAR_WIDTH = 44;
export const WORKSPACE_GAP = 8;

/** Left navigation touches the content; only a closed sidebar leaves an inset. */
export function workspaceFrameWidth(s: Pick<DockState, 'leftPanels'>): number {
  return WORKSPACE_GAP * (s.leftPanels.length ? 1 : 2);
}

/** Reserve useful command space and close the older side when both do not fit. */
function fitPanelSpace(s: DockState, preferred: DockSide): Pick<DockState, 'leftPanels' | 'rightPanels'> {
  const available = window.innerWidth - ACTIVITY_BAR_WIDTH - workspaceFrameWidth(s) - Math.max(360, currentTerminalMinWidth());
  if (available < MIN_PANEL_WIDTH) return { leftPanels: [], rightPanels: [] };
  const panelWidth = (ids: string[]) => ids.reduce((sum, id) => sum + (s.collapsedPanels.includes(id) ? 0 : (s.panelWidths[id] ?? PANEL_DEFS[id]?.width ?? 200)), 0);
  if (panelWidth(s.leftPanels) + panelWidth(s.rightPanels) <= available) {
    return { leftPanels: s.leftPanels, rightPanels: s.rightPanels };
  }
  if (s.leftPanels.length && s.rightPanels.length) {
    return preferred === 'left'
      ? { leftPanels: s.leftPanels, rightPanels: [] }
      : { leftPanels: [], rightPanels: s.rightPanels };
  }
  return { leftPanels: s.leftPanels, rightPanels: s.rightPanels };
}

const saved = loadLayout();

/** 落盘时把「拖动中折叠」的面板按「已关闭」保存（重启后保持关闭，与旧行为一致）。 */
function toPersisted(s: DockState): PersistedLayout {
  const collapsed = new Set(s.collapsedPanels);
  return {
    leftZone: s.leftZone,
    rightZone: s.rightZone,
    leftPanels: s.leftPanels.filter((p) => !collapsed.has(p)),
    rightPanels: s.rightPanels.filter((p) => !collapsed.has(p)),
    panelWidths: s.panelWidths,
  };
}

export const useDockStore = create<DockState>((set) => ({
  leftZone: saved.leftZone,
  rightZone: saved.rightZone,
  leftPanels: saved.leftPanels,
  rightPanels: saved.rightPanels,
  panelWidths: saved.panelWidths,
  collapsedPanels: [],

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
      let idx = atIndex ?? (targetList.length + (from === to ? 1 : 0));
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

      // Reordering preserves visibility; an open panel follows its action across sides.
      const wasOpen = s.leftPanels.includes(id) || s.rightPanels.includes(id);
      let leftPanels = s.leftPanels;
      let rightPanels = s.rightPanels;
      if (from !== to) {
        leftPanels = s.leftPanels.filter(panel => panel !== id);
        rightPanels = s.rightPanels.filter(panel => panel !== id);
        if (wasOpen) {
          if (to === 'left') leftPanels = [id];
          else rightPanels = [id];
        }
      }
      const collapsedPanels = from === to ? s.collapsedPanels : s.collapsedPanels.filter(panel => panel !== id);
      const next = { ...s, leftZone, rightZone, leftPanels, rightPanels, collapsedPanels };
      Object.assign(next, fitPanelSpace(next, to));
      saveLayout(toPersisted(next));
      return next;
    });
  },

  togglePanel: (requestedSide, id) => {
    set((s) => {
      if (!PANEL_DEFS[id]) return s;
      // All entry points follow persisted placement, including older keyboard commands.
      const side = s.leftZone.includes(id) ? 'left' : s.rightZone.includes(id) ? 'right' : requestedSide;
      const panels = side === 'left' ? [...s.leftPanels] : [...s.rightPanels];
      const idx = panels.indexOf(id);
      const wasCollapsed = s.collapsedPanels.includes(id);
      if (idx >= 0 && !wasCollapsed) {
        panels.splice(idx, 1); // 已打开（非折叠）→ 关闭
      } else {
        // 未打开或处于折叠中 → 打开（并清掉折叠标记）
        panels.splice(0, panels.length, id);
      }
      const collapsedPanels = s.collapsedPanels.filter((p) => p !== id);
      const patch: Partial<DockState> = side === 'left'
        ? { leftPanels: panels, collapsedPanels }
        : { rightPanels: panels, collapsedPanels };
      const next = { ...s, ...patch };
      Object.assign(patch, fitPanelSpace(next, side));
      saveLayout(toPersisted({ ...s, ...patch }));
      return patch;
    });
  },

  openPanel: (id) => {
    set((s) => {
      if (!PANEL_DEFS[id]) return s;
      const side: DockSide = s.leftZone.includes(id) ? 'left' : 'right';
      const panels = side === 'left' ? [...s.leftPanels] : [...s.rightPanels];
      const collapsedPanels = s.collapsedPanels.filter((p) => p !== id);
      if (panels.includes(id) && collapsedPanels.length === s.collapsedPanels.length) return {};
      if (!panels.includes(id)) {
        panels.splice(0, panels.length, id);
      }
      const patch: Partial<DockState> = side === 'left'
        ? { leftPanels: panels, collapsedPanels }
        : { rightPanels: panels, collapsedPanels };
      Object.assign(patch, fitPanelSpace({ ...s, ...patch }, side));
      saveLayout(toPersisted({ ...s, ...patch }));
      return patch;
    });
  },

  setPanelWidth: (id, delta) => {
    set((s) => {
      // 用「当前 store 值 + 增量」累加（而非外部传入绝对宽度），消除快速拖动时
      // 渲染闭包陈旧导致的增量丢失（面板不跟手、终端 flex 反而在变）。
      const cur = s.panelWidths[id] ?? PANEL_DEFS[id]?.width ?? 200;
      const next = Math.round(cur + delta);
      // 拖到最小宽度下限 → 折叠：面板保持挂载（内容状态不丢），仅打折叠标记并隐藏，
      // 松手前反向拖回可无损恢复；是否真正下架由 commitPanelWidth 松手定局。
      if (next <= MIN_PANEL_WIDTH) {
        if (s.collapsedPanels.includes(id) && (s.panelWidths[id] ?? 0) === MIN_PANEL_WIDTH) return {};
        const collapsedPanels = s.collapsedPanels.includes(id)
          ? s.collapsedPanels
          : [...s.collapsedPanels, id];
        const panelWidths = { ...s.panelWidths, [id]: MIN_PANEL_WIDTH };
        const patch = { collapsedPanels, panelWidths };
        saveLayout(toPersisted({ ...s, ...patch }));
        return patch as DockState;
      }
      // 未到下限：正常调宽（上限受窗口与终端最小宽约束）
      const allPanels = [...s.leftPanels, ...s.rightPanels];
      let otherWidth = 0;
      for (const pid of allPanels) {
        if (pid === id) continue;
        otherWidth += s.panelWidths[pid] ?? PANEL_DEFS[pid]?.width ?? 200;
      }
      const available = window.innerWidth - ACTIVITY_BAR_WIDTH - workspaceFrameWidth(s) - otherWidth;
      const maxW = Math.max(MIN_PANEL_WIDTH, Math.round(available - Math.max(360, currentTerminalMinWidth())));
      const clamped = Math.max(MIN_PANEL_WIDTH, Math.min(maxW, next));
      if (clamped === cur && !s.collapsedPanels.includes(id)) return {};
      const collapsedPanels = s.collapsedPanels.filter((p) => p !== id);
      const panelWidths = { ...s.panelWidths, [id]: clamped };
      saveLayout(toPersisted({ ...s, panelWidths, collapsedPanels }));
      return { panelWidths, collapsedPanels };
    });
  },

  commitPanelWidth: (id) => {
    set((s) => {
      const cur = s.panelWidths[id] ?? PANEL_DEFS[id]?.width ?? 200;
      const wasCollapsed = s.collapsedPanels.includes(id);
      if (cur > MIN_PANEL_WIDTH) {
        // 反悔拖回后松手：仅清掉折叠标记（面板保持展开、状态无损）
        if (!wasCollapsed) return {};
        const collapsedPanels = s.collapsedPanels.filter((p) => p !== id);
        saveLayout(toPersisted({ ...s, collapsedPanels }));
        return { collapsedPanels };
      }
      // 松手时宽度仍 ≤ 下限 → 正式折叠：从面板列表下架（持久化为关闭）
      const leftPanels = s.leftPanels.includes(id) ? s.leftPanels.filter((p) => p !== id) : s.leftPanels;
      const rightPanels = s.rightPanels.includes(id) ? s.rightPanels.filter((p) => p !== id) : s.rightPanels;
      const collapsedPanels = s.collapsedPanels.filter((p) => p !== id);
      const patch = { leftPanels, rightPanels, collapsedPanels };
      saveLayout(toPersisted({ ...s, ...patch }));
      return patch as DockState;
    });
  },
  reconcilePanelSpace: () => {
    set((s) => {
      const patch = fitPanelSpace(s, s.leftPanels.includes('chat') ? 'left' : s.rightPanels.includes('chat') ? 'right' : s.rightPanels.length ? 'right' : 'left');
      if (patch.leftPanels === s.leftPanels && patch.rightPanels === s.rightPanels) return s;
      saveLayout(toPersisted({ ...s, ...patch }));
      return patch;
    });
  },
}));
